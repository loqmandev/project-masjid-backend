# Database Schema - Masjid Go

PostgreSQL database schema using Drizzle ORM for the Masjid Go gamification features.

## Overview

| Table | Purpose |
|-------|---------|
| `user_profile` | Extends Better Auth user with gamification data (points, ranks, privacy) |
| `achievement_definition` | Catalog of all possible achievements (templates) |
| `user_achievement` | Junction table tracking user progress toward each achievement |
| `check_in` | Records every check-in/check-out event with location and points |
| `daily_masjid_stats` | Aggregated daily visitor counts per masjid |
| `monthly_leaderboard_snapshot` | Historical monthly leaderboard records |

## Entity Relationship Diagram

```
┌─────────────────────┐       ┌──────────────────────────┐
│   Better Auth       │       │  achievement_definition  │
│   user table        │       │                          │
│   (external)        │       │  - id (PK)               │
└─────────┬───────────┘       │  - code (unique)         │
          │                   │  - name, description     │
          │ userId            │  - type (enum)           │
          │                   │  - badgeTier (enum)      │
          ▼                   │  - requiredCount         │
┌─────────────────────┐       └────────────┬─────────────┘
│    user_profile     │                    │
│                     │                    │
│  - id (PK)          │                    │
│  - userId (FK)      │◄───────────────────┼────────────────┐
│  - totalPoints      │                    │                │
│  - monthlyPoints    │       ┌────────────▼─────────────┐  │
│  - globalRank       │       │    user_achievement      │  │
│  - leaderboardAlias │       │                          │  │
│  - privacy settings │       │  - userProfileId (FK) ───┼──┘
└─────────┬───────────┘       │  - achievementDefId (FK) │
          │                   │  - currentProgress       │
          │                   │  - isUnlocked            │
          │                   └──────────────────────────┘
          │
          ▼
┌─────────────────────┐       ┌──────────────────────────┐
│      check_in       │       │   daily_masjid_stats     │
│                     │       │                          │
│  - userProfileId(FK)│       │  - masjidId              │
│  - masjidId         │──────►│  - date                  │
│  - checkInAt        │       │  - visitorCount          │
│  - checkOutAt       │       │  - uniqueVisitorCount    │
│  - status (enum)    │       └──────────────────────────┘
│  - points breakdown │
│  - proximity flags  │
└─────────────────────┘
```

---

## Schema Definition

### Enums

```typescript
// db/schema.ts
import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  real,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Badge tiers - matches theme.ts badges
export const badgeTierEnum = pgEnum('badge_tier', [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
]);

// Check-in status
export const checkInStatusEnum = pgEnum('check_in_status', [
  'checked_in',   // Currently at masjid
  'completed',    // Successfully checked out within proximity
  'incomplete',   // Checked out outside proximity or timed out
]);

// Achievement categories
export const achievementTypeEnum = pgEnum('achievement_type', [
  'explorer',        // Visit X unique masjids
  'prayer_warrior',  // Visit during specific prayer times
  'streak',          // Consecutive days visiting
  'geographic',      // Complete districts/states
  'special',         // One-time special achievements
]);
```

### User Profile Table

```typescript
export const userProfile = pgTable(
  'user_profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Link to Better Auth user table
    userId: text('user_id').notNull().unique(),

    // Points & Stats (denormalized for fast reads)
    totalPoints: integer('total_points').notNull().default(0),
    monthlyPoints: integer('monthly_points').notNull().default(0),
    uniqueMasjidsVisited: integer('unique_masjids_visited').notNull().default(0),
    totalCheckIns: integer('total_check_ins').notNull().default(0),

    // Cached computed values (updated periodically)
    globalRank: integer('global_rank'),
    monthlyRank: integer('monthly_rank'),
    achievementCount: integer('achievement_count').notNull().default(0),

    // Privacy & Leaderboard settings
    showFullNameInLeaderboard: boolean('show_full_name_in_leaderboard').notNull().default(true),
    leaderboardAlias: text('leaderboard_alias'),

    // Streak tracking
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    lastVisitDate: timestamp('last_visit_date', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_user_profile_total_points').on(table.totalPoints),
    index('idx_user_profile_monthly_points').on(table.monthlyPoints),
    index('idx_user_profile_global_rank').on(table.globalRank),
    index('idx_user_profile_monthly_rank').on(table.monthlyRank),
    uniqueIndex('idx_user_profile_user_id').on(table.userId),
  ]
);
```

### Achievement Definition Table

```typescript
export const achievementDefinition = pgTable(
  'achievement_definition',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Unique code for programmatic reference
    code: text('code').notNull().unique(),

    // Display information
    name: text('name').notNull(),
    nameEn: text('name_en'),
    description: text('description').notNull(),
    descriptionEn: text('description_en'),

    // Achievement categorization
    type: achievementTypeEnum('type').notNull(),
    badgeTier: badgeTierEnum('badge_tier').notNull(),

    // Requirement
    requiredCount: integer('required_count'),

    // Points awarded on unlock
    bonusPoints: integer('bonus_points').notNull().default(0),

    // Display order
    sortOrder: integer('sort_order').notNull().default(0),

    // Metadata
    iconUrl: text('icon_url'),
    isActive: boolean('is_active').notNull().default(true),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_achievement_def_type').on(table.type),
    index('idx_achievement_def_badge_tier').on(table.badgeTier),
    index('idx_achievement_def_sort_order').on(table.sortOrder),
    uniqueIndex('idx_achievement_def_code').on(table.code),
  ]
);
```

### User Achievement Progress Table

```typescript
export const userAchievement = pgTable(
  'user_achievement',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Foreign keys
    userProfileId: uuid('user_profile_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),
    achievementDefinitionId: uuid('achievement_definition_id')
      .notNull()
      .references(() => achievementDefinition.id, { onDelete: 'cascade' }),

    // Progress tracking
    currentProgress: integer('current_progress').notNull().default(0),
    requiredProgress: integer('required_progress').notNull(),
    progressPercentage: real('progress_percentage').notNull().default(0),

    // Unlock status
    isUnlocked: boolean('is_unlocked').notNull().default(false),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }),

    // Optional metadata for complex achievements
    progressMetadata: text('progress_metadata'), // JSON string

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_user_achievement_unique').on(
      table.userProfileId,
      table.achievementDefinitionId
    ),
    index('idx_user_achievement_user').on(table.userProfileId),
    index('idx_user_achievement_unlocked').on(table.isUnlocked),
  ]
);
```

### Check-In Table

```typescript
export const checkIn = pgTable(
  'check_in',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Foreign key to user profile
    userProfileId: uuid('user_profile_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),

    // Reference to external masjid (stored in DynamoDB)
    masjidId: text('masjid_id').notNull(),
    masjidName: text('masjid_name').notNull(),

    // Check-in details
    checkInAt: timestamp('check_in_at', { withTimezone: true }).notNull().defaultNow(),
    checkInLat: real('check_in_lat').notNull(),
    checkInLng: real('check_in_lng').notNull(),

    // Check-out details (nullable until checkout)
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),
    checkOutLat: real('check_out_lat'),
    checkOutLng: real('check_out_lng'),

    // Status
    status: checkInStatusEnum('status').notNull().default('checked_in'),

    // Points breakdown
    basePoints: integer('base_points').notNull().default(0),
    bonusPoints: integer('bonus_points').notNull().default(0),
    actualPointsEarned: integer('actual_points_earned').notNull().default(0),

    // Checkout proximity tracking (affects points)
    checkoutInProximity: boolean('checkout_in_proximity'),

    // Duration
    durationMinutes: integer('duration_minutes'),

    // Context flags
    isPrayerTime: boolean('is_prayer_time').notNull().default(false),
    prayerName: text('prayer_name'), // 'subuh', 'zohor', 'asar', 'maghrib', 'isyak'
    isFirstVisitToMasjid: boolean('is_first_visit_to_masjid').notNull().default(false),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_check_in_user').on(table.userProfileId),
    index('idx_check_in_masjid').on(table.masjidId),
    index('idx_check_in_status').on(table.status),
    index('idx_check_in_check_in_at').on(table.checkInAt),
    index('idx_check_in_user_date').on(table.userProfileId, table.checkInAt),
    index('idx_check_in_masjid_date').on(table.masjidId, table.checkInAt),
    index('idx_check_in_user_status').on(table.userProfileId, table.status),
  ]
);
```

### Daily Masjid Stats Table

```typescript
export const dailyMasjidStats = pgTable(
  'daily_masjid_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Reference to external masjid
    masjidId: text('masjid_id').notNull(),

    // Date (just the date part)
    date: timestamp('date', { withTimezone: true }).notNull(),

    // Aggregated stats
    visitorCount: integer('visitor_count').notNull().default(0),
    uniqueVisitorCount: integer('unique_visitor_count').notNull().default(0),
    totalPointsAwarded: integer('total_points_awarded').notNull().default(0),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_daily_masjid_stats_unique').on(table.masjidId, table.date),
    index('idx_daily_masjid_stats_date').on(table.date),
    index('idx_daily_masjid_stats_masjid').on(table.masjidId),
  ]
);
```

### Monthly Leaderboard Snapshot Table

```typescript
export const monthlyLeaderboardSnapshot = pgTable(
  'monthly_leaderboard_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Month identifier (YYYY-MM format)
    month: text('month').notNull(),

    // User reference
    userProfileId: uuid('user_profile_id')
      .notNull()
      .references(() => userProfile.id, { onDelete: 'cascade' }),

    // Rank and stats at month end
    rank: integer('rank').notNull(),
    totalPoints: integer('total_points').notNull(),
    masjidsVisited: integer('masjids_visited').notNull(),

    // Display info (snapshot at time of record)
    displayName: text('display_name').notNull(),
    isAnonymous: boolean('is_anonymous').notNull().default(false),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_monthly_leaderboard_unique').on(table.month, table.userProfileId),
    index('idx_monthly_leaderboard_month').on(table.month),
    index('idx_monthly_leaderboard_rank').on(table.month, table.rank),
  ]
);
```

---

## Relations

```typescript
export const userProfileRelations = relations(userProfile, ({ many }) => ({
  achievements: many(userAchievement),
  checkIns: many(checkIn),
  leaderboardSnapshots: many(monthlyLeaderboardSnapshot),
}));

export const achievementDefinitionRelations = relations(achievementDefinition, ({ many }) => ({
  userAchievements: many(userAchievement),
}));

export const userAchievementRelations = relations(userAchievement, ({ one }) => ({
  userProfile: one(userProfile, {
    fields: [userAchievement.userProfileId],
    references: [userProfile.id],
  }),
  achievementDefinition: one(achievementDefinition, {
    fields: [userAchievement.achievementDefinitionId],
    references: [achievementDefinition.id],
  }),
}));

export const checkInRelations = relations(checkIn, ({ one }) => ({
  userProfile: one(userProfile, {
    fields: [checkIn.userProfileId],
    references: [userProfile.id],
  }),
}));

export const monthlyLeaderboardSnapshotRelations = relations(
  monthlyLeaderboardSnapshot,
  ({ one }) => ({
    userProfile: one(userProfile, {
      fields: [monthlyLeaderboardSnapshot.userProfileId],
      references: [userProfile.id],
    }),
  })
);
```

---

## Type Exports

```typescript
export type UserProfile = typeof userProfile.$inferSelect;
export type NewUserProfile = typeof userProfile.$inferInsert;

export type AchievementDefinition = typeof achievementDefinition.$inferSelect;
export type NewAchievementDefinition = typeof achievementDefinition.$inferInsert;

export type UserAchievement = typeof userAchievement.$inferSelect;
export type NewUserAchievement = typeof userAchievement.$inferInsert;

export type CheckIn = typeof checkIn.$inferSelect;
export type NewCheckIn = typeof checkIn.$inferInsert;

export type DailyMasjidStats = typeof dailyMasjidStats.$inferSelect;
export type NewDailyMasjidStats = typeof dailyMasjidStats.$inferInsert;

export type MonthlyLeaderboardSnapshot = typeof monthlyLeaderboardSnapshot.$inferSelect;
export type NewMonthlyLeaderboardSnapshot = typeof monthlyLeaderboardSnapshot.$inferInsert;
```

---

## Seed Data

### Initial Achievements

```typescript
// db/seed.ts
export const initialAchievements = [
  {
    code: 'explorer_5',
    name: 'Pengembara Pemula',
    nameEn: 'Beginner Explorer',
    description: 'Lawati 5 masjid yang berbeza',
    descriptionEn: 'Visit 5 different masjids',
    type: 'explorer' as const,
    badgeTier: 'bronze' as const,
    requiredCount: 5,
    bonusPoints: 25,
    sortOrder: 1,
  },
  {
    code: 'explorer_10',
    name: 'Pengembara Aktif',
    nameEn: 'Active Explorer',
    description: 'Lawati 10 masjid yang berbeza',
    descriptionEn: 'Visit 10 different masjids',
    type: 'explorer' as const,
    badgeTier: 'silver' as const,
    requiredCount: 10,
    bonusPoints: 50,
    sortOrder: 2,
  },
  {
    code: 'explorer_15',
    name: 'Pengembara Dedikasi',
    nameEn: 'Dedicated Explorer',
    description: 'Lawati 15 masjid yang berbeza',
    descriptionEn: 'Visit 15 different masjids',
    type: 'explorer' as const,
    badgeTier: 'gold' as const,
    requiredCount: 15,
    bonusPoints: 100,
    sortOrder: 3,
  },
  {
    code: 'explorer_20',
    name: 'Pengembara Hebat',
    nameEn: 'Great Explorer',
    description: 'Lawati 20 masjid yang berbeza',
    descriptionEn: 'Visit 20 different masjids',
    type: 'explorer' as const,
    badgeTier: 'platinum' as const,
    requiredCount: 20,
    bonusPoints: 200,
    sortOrder: 4,
  },
];
```

---

## Example Queries

### Get Top 8 Monthly Leaderboard

```typescript
const monthlyTop8 = await db
  .select({
    rank: userProfile.monthlyRank,
    displayName: sql`CASE
      WHEN ${userProfile.showFullNameInLeaderboard} = false
      THEN COALESCE(${userProfile.leaderboardAlias}, 'Anonymous')
      ELSE ${user.name}
    END`,
    points: userProfile.monthlyPoints,
    masjidsVisited: userProfile.uniqueMasjidsVisited,
  })
  .from(userProfile)
  .innerJoin(user, eq(userProfile.userId, user.id))
  .orderBy(desc(userProfile.monthlyPoints))
  .limit(8);
```

### Get User Achievement Progress

```typescript
const userAchievements = await db
  .select({
    code: achievementDefinition.code,
    name: achievementDefinition.name,
    badgeTier: achievementDefinition.badgeTier,
    currentProgress: userAchievement.currentProgress,
    requiredProgress: userAchievement.requiredProgress,
    isUnlocked: userAchievement.isUnlocked,
    unlockedAt: userAchievement.unlockedAt,
  })
  .from(userAchievement)
  .innerJoin(
    achievementDefinition,
    eq(userAchievement.achievementDefinitionId, achievementDefinition.id)
  )
  .where(eq(userAchievement.userProfileId, profileId))
  .orderBy(achievementDefinition.sortOrder);
```

### Get Daily Visitor Count for a Masjid

```typescript
const today = new Date();
today.setHours(0, 0, 0, 0);

const todayVisitors = await db
  .select({ count: count() })
  .from(checkIn)
  .where(
    and(
      eq(checkIn.masjidId, masjidId),
      gte(checkIn.checkInAt, today)
    )
  );
```

### Get Active Check-In for User

```typescript
const activeCheckIn = await db
  .select()
  .from(checkIn)
  .where(
    and(
      eq(checkIn.userProfileId, profileId),
      eq(checkIn.status, 'checked_in')
    )
  )
  .limit(1);
```

---

## Points System

| Action | Points | Notes |
|--------|--------|-------|
| Basic Visit (completed) | 10 | Full checkout within proximity |
| Basic Visit (incomplete) | 5 | Checkout outside proximity |
| Prayer Time Bonus | +10 | During Subuh, Zohor, Asar, Maghrib, Isyak |
| First Visit to Masjid | +5 | User's first time at this masjid |
| Achievement Unlock | varies | 25-200 points based on tier |

### Points Reduction Logic

```typescript
// When checkout is outside proximity
if (!checkoutInProximity) {
  actualPointsEarned = Math.floor(basePoints * 0.5); // 50% reduction
  status = 'incomplete';
}
```

---

## Design Decisions

1. **UUID Primary Keys**: Better for distributed systems and avoids sequential ID enumeration

2. **Denormalized Stats**: `userProfile` stores cached counts for fast leaderboard queries without expensive JOINs

3. **Separate Achievement Tables**: Definition/progress split allows easy addition of new achievements without schema changes

4. **Points Breakdown**: Storing `basePoints`, `bonusPoints`, and `actualPointsEarned` separately provides transparency

5. **Foreign Key Cascades**: `onDelete: 'cascade'` ensures data integrity when profiles are deleted

6. **Timezone-aware Timestamps**: Using `withTimezone: true` for proper handling across Malaysia's timezone (GMT+8)

7. **External Masjid Reference**: Masjid data stays in DynamoDB; only `masjidId` is stored in PostgreSQL
