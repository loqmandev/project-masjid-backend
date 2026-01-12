import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import Geohash from "ngeohash";
import { dynamodb, TABLE_NAME } from "../lib/dynamodb";
import { haversineDistance } from "../utils/geo";

// 1. Get masjid by ID
export async function getMasjidById(masjidId: string) {
  const result = await dynamodb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `MASJID#${masjidId}`, SK: "DATA" },
    })
  );
  return result.Item;
}

// 1b. Check-in to a specific masjid (verify proximity)
export async function checkinToMasjid(
  masjidId: string,
  userLat: number,
  userLng: number
): Promise<{
  success: boolean;
  masjid?: Record<string, unknown>;
  distanceM?: number;
  message: string;
}> {
  // Get masjid data
  const masjid = await getMasjidById(masjidId);

  if (!masjid) {
    return { success: false, message: "Masjid not found" };
  }

  const masjidLat = masjid.lat as number;
  const masjidLng = masjid.lng as number;
  const checkinRadiusM = (masjid.checkinRadiusM as number) || 100;

  // Calculate distance
  const distanceKm = haversineDistance(userLat, userLng, masjidLat, masjidLng);
  const distanceM = Math.round(distanceKm * 1000);

  // Check if within check-in radius
  if (distanceM > checkinRadiusM) {
    return {
      success: false,
      distanceM,
      message: `Too far from masjid. You are ${distanceM}m away, must be within ${checkinRadiusM}m`,
    };
  }

  // TODO: Insert check-in record to PostgreSQL
  // const checkinRecord = {
  //   id: generateUUID(),
  //   masjidId,
  //   userId: currentUser.id,
  //   checkinTime: new Date().toISOString(),
  //   lat: userLat,
  //   lng: userLng,
  //   distanceM,
  // };
  // await db.insert(checkins).values(checkinRecord);

  return {
    success: true,
    masjid: {
      masjidId: masjid.masjidId,
      name: masjid.name,
      address: masjid.address,
      districtName: masjid.districtName,
      stateName: masjid.stateName,
      lat: masjidLat,
      lng: masjidLng,
    },
    distanceM,
    message: "Check-in successful",
  };
}

// 2. Get nearby masjids (flexible radius, capped at MAX_RADIUS_KM)
const MAX_RADIUS_KM = 5;
const DEFAULT_RADIUS_KM = 5;

export async function getNearbyMasjids(
  lat: number,
  lng: number,
  radiusKm: number = DEFAULT_RADIUS_KM
) {
  // Cap radius to maximum allowed
  const effectiveRadius = Math.min(radiusKm, MAX_RADIUS_KM);

  const centerGeohash = Geohash.encode(lat, lng, 5);
  const neighbors = Geohash.neighbors(centerGeohash);
  const cellsToQuery = [centerGeohash, ...Object.values(neighbors)];

  const queries = cellsToQuery.map((cell) =>
    dynamodb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :pk",
        ExpressionAttributeValues: { ":pk": `GEO#${cell}` },
        ProjectionExpression:
          "masjidId, #n, lat, lng, districtName, stateName, checkinRadiusM",
        ExpressionAttributeNames: { "#n": "name" },
      })
    )
  );

  const results = await Promise.all(queries);
  const allMasjids = results.flatMap((r) => r.Items || []);

  return allMasjids
    .map((m) => {
      const distanceKm = haversineDistance(lat, lng, m.lat as number, m.lng as number);
      const distanceM = distanceKm * 1000;
      const checkinRadiusM = (m.checkinRadiusM as number) || 100;
      return {
        ...m,
        distance: distanceKm,
        distanceM: Math.round(distanceM),
        canCheckin: distanceM <= checkinRadiusM,
      };
    })
    .filter((m) => m.distance <= effectiveRadius)
    .sort((a, b) => a.distance - b.distance);
}

// 2b. Get masjids available for check-in (within check-in radius)
export async function getCheckinEligibleMasjids(lat: number, lng: number) {
  // Use smaller geohash precision for nearby check (100m range)
  // 7-char geohash = ~150m precision, good for check-in detection
  const centerGeohash = Geohash.encode(lat, lng, 6); // 6-char = ~600m cells
  const neighbors = Geohash.neighbors(centerGeohash);
  const cellsToQuery = [centerGeohash, ...Object.values(neighbors)];

  // Need to query with 5-char prefix since that's our GSI2PK
  const uniquePrefixes = [...new Set(cellsToQuery.map((c) => c.substring(0, 5)))];

  const queries = uniquePrefixes.map((cell) =>
    dynamodb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :pk",
        ExpressionAttributeValues: { ":pk": `GEO#${cell}` },
        ProjectionExpression:
          "masjidId, #n, lat, lng, districtName, stateName, checkinRadiusM, address",
        ExpressionAttributeNames: { "#n": "name" },
      })
    )
  );

  const results = await Promise.all(queries);
  const allMasjids = results.flatMap((r) => r.Items || []);

  return allMasjids
    .map((m) => {
      const distanceKm = haversineDistance(lat, lng, m.lat as number, m.lng as number);
      const distanceM = distanceKm * 1000;
      const checkinRadiusM = (m.checkinRadiusM as number) || 100;
      return {
        ...m,
        distanceM: Math.round(distanceM),
        checkinRadiusM,
        canCheckin: distanceM <= checkinRadiusM,
      };
    })
    .filter((m) => m.canCheckin) // Only return masjids within check-in range
    .sort((a, b) => a.distanceM - b.distanceM);
}

// 3. Get masjids by state
export async function getMasjidsByState(stateCode: string) {
  const result = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": `STATE#${stateCode}` },
      ProjectionExpression:
        "masjidId, #n, lat, lng, districtName, stateName, districtCode",
      ExpressionAttributeNames: { "#n": "name" },
    })
  );
  return result.Items || [];
}

// 4. Get masjids by district
export async function getMasjidsByDistrict(
  stateCode: string,
  districtCode: string
) {
  const result = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": `STATE#${stateCode}`,
        ":sk": `DISTRICT#${districtCode}#`,
      },
      ProjectionExpression: "masjidId, #n, lat, lng, districtName, stateName",
      ExpressionAttributeNames: { "#n": "name" },
    })
  );
  return result.Items || [];
}

// 5. Search masjids by name
export async function searchMasjidsByName(searchTerm: string, limit = 20) {
  const normalizedSearch = searchTerm.toLowerCase().trim();

  const result = await dynamodb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI3",
      KeyConditionExpression: "GSI3PK = :pk AND begins_with(GSI3SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": "MASJID_SEARCH",
        ":sk": normalizedSearch,
      },
      Limit: limit,
      ProjectionExpression: "masjidId, #n, lat, lng, districtName, stateName",
      ExpressionAttributeNames: { "#n": "name" },
    })
  );
  return result.Items || [];
}
