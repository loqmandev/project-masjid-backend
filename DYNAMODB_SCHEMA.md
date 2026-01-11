# Masjid Directory - DynamoDB Schema Design

## Overview

DynamoDB is used **only** for the masjid directory (read-heavy, geo-distributed data). All other data (users, visits, achievements, leaderboard) resides in PostgreSQL.

## Data Requirements by Screen

### Home Screen - Nearby Masjids
```typescript
// Required fields from DynamoDB:
{
  masjidId: string;
  name: string;
  districtName: string;
  stateName: string;
  lat: number;
  lng: number;
}
// Note: "visited" status comes from PostgreSQL
```

### Explore Screen - Masjid List
```typescript
// Required fields from DynamoDB:
{
  masjidId: string;
  name: string;
  districtName: string;
  stateName: string;
  lat: number;
  lng: number;
}
// Note: "visited", "isFirstVisitor" comes from PostgreSQL
```

### Masjid Detail Screen
```typescript
// Required fields from DynamoDB:
{
  masjidId: string;
  name: string;
  nameEn?: string;
  address: string;
  stateCode: string;
  stateName: string;
  districtCode: string;
  districtName: string;
  lat: number;
  lng: number;
  jakimCode?: string;
  donationUrl?: string;
  contactPhone?: string;
  websiteUrl?: string;
  facilities: MasjidFacilities;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}
// Note: totalVisits, firstVisitorName, photos, userVisitHistory from PostgreSQL
```

---

## Access Patterns (No Scans!)

| # | Access Pattern | Used In | Frequency |
|---|----------------|---------|-----------|
| 1 | Get masjid by ID | Masjid Detail | High |
| 2 | Get nearby masjids (within radius) | Home, Explore | Very High |
| 3 | Get masjids by state | Explore (filter) | Medium |
| 4 | Get masjids by district | Explore (filter) | Medium |
| 5 | Search masjids by name prefix | Explore (search) | Medium |

---

## Table Design

### Table Name: `MasjidDirectory`

### Primary Key
- **PK (Partition Key)**: `MASJID#<masjidId>`
- **SK (Sort Key)**: `DATA`

### Item Structure

```typescript
interface MasjidItem {
  // Primary Key
  PK: `MASJID#${string}`;          // MASJID#uuid
  SK: 'DATA';

  // Entity type (for single-table patterns if needed later)
  entityType: 'MASJID';

  // Core identification
  masjidId: string;                 // UUID
  name: string;                     // "Masjid Sultan Salahuddin Abdul Aziz Shah"
  nameEn?: string;                  // English name if different
  nameLower: string;                // Lowercase for search: "masjid sultan salahuddin..."

  // Location - Coordinates
  lat: number;                      // 3.0738
  lng: number;                      // 101.5183
  geohash: string;                  // Full precision: "w284em3" (7 chars)

  // Location - Address
  address: string;                  // Full address
  postcode?: string;

  // Location - Administrative
  stateCode: string;                // "SGR"
  stateName: string;                // "Selangor"
  districtCode: string;             // "PTG"
  districtName: string;             // "Petaling"

  // External references
  jakimCode?: string;               // JAKIM mosque code

  // Contact & Links
  donationUrl?: string;
  contactPhone?: string;
  websiteUrl?: string;

  // Facilities (embedded document)
  facilities: {
    parking: boolean;
    wudhuArea: boolean;
    airConditioning: boolean;
    wheelchairAccess: boolean;
    womenSection: boolean;
    funeralServices: boolean;
    library: boolean;
    conferenceRoom: boolean;
  };

  // Status
  verified: boolean;                // Admin verified
  active: boolean;                  // Is active/operational

  // Timestamps
  createdAt: string;                // ISO 8601
  updatedAt: string;

  // ===== GSI Keys =====

  // GSI1: Query by State/District
  GSI1PK: `STATE#${string}`;                              // STATE#SGR
  GSI1SK: `DISTRICT#${string}#MASJID#${string}`;          // DISTRICT#PTG#MASJID#uuid

  // GSI2: Query by Geohash (proximity search)
  GSI2PK: `GEO#${string}`;                                // GEO#w284e (5-char ~5km cell)
  GSI2SK: `${string}#MASJID#${string}`;                   // w284em3#MASJID#uuid (7-char for sort)

  // GSI3: Search by Name
  GSI3PK: 'MASJID_SEARCH';                                // Fixed partition for name search
  GSI3SK: `${string}#${string}`;                          // nameLower#masjidId
}
```

---

## Global Secondary Indexes

### GSI1: State-District Index
**Purpose**: Query masjids by state or by specific district within a state

| Attribute | Key Type |
|-----------|----------|
| GSI1PK | Partition Key |
| GSI1SK | Sort Key |

**Projection**: ALL (or selected attributes for list views)

### GSI2: Geohash Index
**Purpose**: Proximity queries - find masjids near a location

| Attribute | Key Type |
|-----------|----------|
| GSI2PK | Partition Key |
| GSI2SK | Sort Key |

**Projection**: KEYS_ONLY + lat, lng, name, districtName, stateName, masjidId

### GSI3: Name Search Index
**Purpose**: Search masjids by name prefix

| Attribute | Key Type |
|-----------|----------|
| GSI3PK | Partition Key |
| GSI3SK | Sort Key |

**Projection**: KEYS_ONLY + name, districtName, stateName, lat, lng, masjidId

---

## Query Patterns & Implementation

### 1. Get Masjid by ID

```typescript
// Access Pattern: Masjid Detail Screen
const getMasjidById = async (masjidId: string): Promise<Masjid> => {
  const result = await dynamodb.send(new GetCommand({
    TableName: 'MasjidDirectory',
    Key: {
      PK: `MASJID#${masjidId}`,
      SK: 'DATA'
    }
  }));

  return result.Item as Masjid;
};
```

**Complexity**: O(1) - Single item lookup
**RCU**: 0.5 RCU (eventually consistent) or 1 RCU (strongly consistent)

---

### 2. Get Nearby Masjids (Proximity Query)

```typescript
// Access Pattern: Home Screen, Explore Screen (default view)
// Strategy: Query geohash cells that overlap with search radius

import Geohash from 'ngeohash';

const getNearbyMasjids = async (
  lat: number,
  lng: number,
  radiusKm: number = 10
): Promise<Masjid[]> => {
  // Get center geohash (5-char precision = ~5km x 5km cell)
  const centerGeohash = Geohash.encode(lat, lng, 5);

  // Get 9 cells (center + 8 neighbors) to cover radius
  const neighbors = Geohash.neighbors(centerGeohash);
  const cellsToQuery = [centerGeohash, ...Object.values(neighbors)];

  // Query all cells in parallel
  const queries = cellsToQuery.map(cell =>
    dynamodb.send(new QueryCommand({
      TableName: 'MasjidDirectory',
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `GEO#${cell}`
      },
      ProjectionExpression: 'masjidId, #n, lat, lng, districtName, stateName',
      ExpressionAttributeNames: {
        '#n': 'name'
      }
    }))
  );

  const results = await Promise.all(queries);

  // Combine and filter by actual distance
  const allMasjids = results.flatMap(r => r.Items || []);

  return allMasjids
    .map(m => ({
      ...m,
      distance: haversineDistance(lat, lng, m.lat, m.lng)
    }))
    .filter(m => m.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance);
};

// Haversine formula for distance calculation
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * Math.PI / 180;
}
```

**Complexity**: O(1) per cell, 9 parallel queries
**RCU**: ~4.5 RCU total (assuming ~50 masjids per cell, eventually consistent)

---

### 3. Get Masjids by State

```typescript
// Access Pattern: Explore Screen - State filter
const getMasjidsByState = async (stateCode: string): Promise<Masjid[]> => {
  const result = await dynamodb.send(new QueryCommand({
    TableName: 'MasjidDirectory',
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `STATE#${stateCode}`
    },
    ProjectionExpression: 'masjidId, #n, lat, lng, districtName, stateName, districtCode',
    ExpressionAttributeNames: {
      '#n': 'name'
    }
  }));

  return result.Items as Masjid[];
};
```

**Complexity**: O(1) query, returns all masjids in state
**RCU**: Varies by state size (Selangor ~500 masjids = ~2.5 RCU)

---

### 4. Get Masjids by District

```typescript
// Access Pattern: Explore Screen - District filter
const getMasjidsByDistrict = async (
  stateCode: string,
  districtCode: string
): Promise<Masjid[]> => {
  const result = await dynamodb.send(new QueryCommand({
    TableName: 'MasjidDirectory',
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `STATE#${stateCode}`,
      ':sk': `DISTRICT#${districtCode}#`
    },
    ProjectionExpression: 'masjidId, #n, lat, lng, districtName, stateName',
    ExpressionAttributeNames: {
      '#n': 'name'
    }
  }));

  return result.Items as Masjid[];
};
```

**Complexity**: O(1) query
**RCU**: Varies by district size (avg ~25 masjids = ~0.2 RCU)

---

### 5. Search Masjids by Name

```typescript
// Access Pattern: Explore Screen - Search box
const searchMasjidsByName = async (
  searchTerm: string,
  limit: number = 20
): Promise<Masjid[]> => {
  const normalizedSearch = searchTerm.toLowerCase().trim();

  const result = await dynamodb.send(new QueryCommand({
    TableName: 'MasjidDirectory',
    IndexName: 'GSI3',
    KeyConditionExpression: 'GSI3PK = :pk AND begins_with(GSI3SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': 'MASJID_SEARCH',
      ':sk': normalizedSearch
    },
    Limit: limit,
    ProjectionExpression: 'masjidId, #n, lat, lng, districtName, stateName',
    ExpressionAttributeNames: {
      '#n': 'name'
    }
  }));

  return result.Items as Masjid[];
};
```

**Complexity**: O(1) query
**RCU**: ~0.1 RCU for 20 results

**Note**: GSI3 uses a single partition key which could become a hot partition with scale. For production, consider:
1. Adding state prefix: `GSI3PK = SEARCH#<stateCode>`
2. Using OpenSearch for full-text search

---

## Example Item

```json
{
  "PK": "MASJID#550e8400-e29b-41d4-a716-446655440001",
  "SK": "DATA",
  "entityType": "MASJID",

  "masjidId": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Masjid Sultan Salahuddin Abdul Aziz Shah",
  "nameEn": "Sultan Salahuddin Abdul Aziz Shah Mosque",
  "nameLower": "masjid sultan salahuddin abdul aziz shah",

  "lat": 3.0738,
  "lng": 101.5183,
  "geohash": "w284em3",

  "address": "Persiaran Masjid, Seksyen 14, 40000 Shah Alam, Selangor",
  "postcode": "40000",

  "stateCode": "SGR",
  "stateName": "Selangor",
  "districtCode": "PTG",
  "districtName": "Petaling",

  "jakimCode": "SGR001",
  "donationUrl": "https://masjidsas.gov.my/derma",
  "contactPhone": "+60355198988",
  "websiteUrl": "https://masjidsas.gov.my",

  "facilities": {
    "parking": true,
    "wudhuArea": true,
    "airConditioning": true,
    "wheelchairAccess": true,
    "womenSection": true,
    "funeralServices": true,
    "library": true,
    "conferenceRoom": true
  },

  "verified": true,
  "active": true,

  "createdAt": "2024-01-15T08:00:00.000Z",
  "updatedAt": "2024-06-20T14:30:00.000Z",

  "GSI1PK": "STATE#SGR",
  "GSI1SK": "DISTRICT#PTG#MASJID#550e8400-e29b-41d4-a716-446655440001",

  "GSI2PK": "GEO#w284e",
  "GSI2SK": "w284em3#MASJID#550e8400-e29b-41d4-a716-446655440001",

  "GSI3PK": "MASJID_SEARCH",
  "GSI3SK": "masjid sultan salahuddin abdul aziz shah#550e8400-e29b-41d4-a716-446655440001"
}
```

---

## Geohash Reference

| Precision | Cell Size | Use Case |
|-----------|-----------|----------|
| 4 chars | ~20km x 20km | Country-level queries |
| 5 chars | ~5km x 5km | **Used for GSI2PK** - City area |
| 6 chars | ~1km x 1km | Neighborhood |
| 7 chars | ~150m x 150m | **Used for GSI2SK** - Sorting precision |
| 8 chars | ~40m x 40m | Building level |

**Malaysia Geohash Prefixes**:
- Peninsular: `w2` (most), `w1`, `w3`
- Sabah: `w5`
- Sarawak: `w4`

---

## Capacity Planning

### Estimated Data Size
- ~2,500 masjids in Malaysia
- Average item size: ~1KB
- Total data: ~2.5MB (fits easily in free tier)

### Read Capacity
| Operation | RCU per Request | Estimated Daily | Daily RCU |
|-----------|-----------------|-----------------|-----------|
| Get by ID | 1 | 5,000 | 5,000 |
| Nearby (9 cells) | 5 | 10,000 | 50,000 |
| By State | 3 | 1,000 | 3,000 |
| By District | 0.5 | 2,000 | 1,000 |
| Name Search | 0.5 | 3,000 | 1,500 |
| **Total** | | | **~60,500** |

**Recommendation**: On-Demand capacity mode (pay-per-request) for MVP

### Write Capacity
- Masjid data is mostly static (added by admins, community submissions)
- Estimated: <100 writes/day
- Write cost negligible

---

## AWS SAM/CloudFormation Template

```yaml
Resources:
  MasjidDirectoryTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: MasjidDirectory
      BillingMode: PAY_PER_REQUEST

      AttributeDefinitions:
        - AttributeName: PK
          AttributeType: S
        - AttributeName: SK
          AttributeType: S
        - AttributeName: GSI1PK
          AttributeType: S
        - AttributeName: GSI1SK
          AttributeType: S
        - AttributeName: GSI2PK
          AttributeType: S
        - AttributeName: GSI2SK
          AttributeType: S
        - AttributeName: GSI3PK
          AttributeType: S
        - AttributeName: GSI3SK
          AttributeType: S

      KeySchema:
        - AttributeName: PK
          KeyType: HASH
        - AttributeName: SK
          KeyType: RANGE

      GlobalSecondaryIndexes:
        # GSI1: State/District queries
        - IndexName: GSI1
          KeySchema:
            - AttributeName: GSI1PK
              KeyType: HASH
            - AttributeName: GSI1SK
              KeyType: RANGE
          Projection:
            ProjectionType: ALL

        # GSI2: Geolocation queries
        - IndexName: GSI2
          KeySchema:
            - AttributeName: GSI2PK
              KeyType: HASH
            - AttributeName: GSI2SK
              KeyType: RANGE
          Projection:
            ProjectionType: INCLUDE
            NonKeyAttributes:
              - masjidId
              - name
              - lat
              - lng
              - districtName
              - stateName

        # GSI3: Name search
        - IndexName: GSI3
          KeySchema:
            - AttributeName: GSI3PK
              KeyType: HASH
            - AttributeName: GSI3SK
              KeyType: RANGE
          Projection:
            ProjectionType: INCLUDE
            NonKeyAttributes:
              - masjidId
              - name
              - lat
              - lng
              - districtName
              - stateName

      Tags:
        - Key: Application
          Value: MasjidGo
        - Key: Environment
          Value: Production
```

---

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SCREEN DATA FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  HOME SCREEN                                                             │
│  ┌──────────────────┐     ┌──────────────────┐                          │
│  │   DynamoDB       │     │   PostgreSQL     │                          │
│  │   (GSI2 Query)   │  +  │   (User Visits)  │  →  Nearby Masjids List │
│  │   Nearby masjids │     │   visited status │                          │
│  └──────────────────┘     └──────────────────┘                          │
│                                                                          │
│  EXPLORE SCREEN                                                          │
│  ┌──────────────────┐     ┌──────────────────┐                          │
│  │   DynamoDB       │     │   PostgreSQL     │                          │
│  │   GSI1 or GSI2   │  +  │   User Visits    │  →  Filtered Masjid List │
│  │   or GSI3 query  │     │   First Visitor  │                          │
│  └──────────────────┘     └──────────────────┘                          │
│                                                                          │
│  MASJID DETAIL SCREEN                                                    │
│  ┌──────────────────┐     ┌──────────────────┐                          │
│  │   DynamoDB       │     │   PostgreSQL     │                          │
│  │   (GetItem)      │  +  │   - totalVisits  │  →  Full Masjid Details  │
│  │   Full masjid    │     │   - firstVisitor │                          │
│  │   data           │     │   - photos       │                          │
│  │                  │     │   - user history │                          │
│  └──────────────────┘     └──────────────────┘                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Why This Design Works

1. **No Scan Operations**: Every access pattern uses Query or GetItem with exact key conditions

2. **Efficient Proximity Search**: Geohash-based GSI2 allows querying ~5km cells, with 9 parallel queries covering any 10km radius

3. **Hierarchical Filtering**: GSI1 supports both state-level and district-level filtering with the same index using `begins_with`

4. **Search Capability**: GSI3 enables prefix-based name search without scanning

5. **Minimal Data Duplication**: Only GSI keys are duplicated, not full item data

6. **Cost Effective**: On-demand pricing + small data size = low cost for MVP scale
