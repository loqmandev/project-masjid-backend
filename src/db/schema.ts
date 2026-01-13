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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const user = pgTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ============ Gamification Enums ============

export const badgeTierEnum = pgEnum("badge_tier", [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
]);

export const checkInStatusEnum = pgEnum("check_in_status", [
  "checked_in",
  "completed",
  "incomplete",
]);

export const achievementTypeEnum = pgEnum("achievement_type", [
  "explorer",
  "prayer_warrior",
  "streak",
  "geographic",
  "special",
]);

// ============ Gamification Tables ============

export const userProfile = pgTable(
  "user_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),

    // Points & Stats
    totalPoints: integer("total_points").notNull().default(0),
    monthlyPoints: integer("monthly_points").notNull().default(0),
    uniqueMasjidsVisited: integer("unique_masjids_visited").notNull().default(0),
    totalCheckIns: integer("total_check_ins").notNull().default(0),

    // Cached ranks
    globalRank: integer("global_rank"),
    monthlyRank: integer("monthly_rank"),
    achievementCount: integer("achievement_count").notNull().default(0),

    // Privacy & Leaderboard
    showFullNameInLeaderboard: boolean("show_full_name_in_leaderboard").notNull().default(true),
    leaderboardAlias: text("leaderboard_alias"),

    // Streak tracking
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    lastVisitDate: timestamp("last_visit_date", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_user_profile_total_points").on(table.totalPoints),
    index("idx_user_profile_monthly_points").on(table.monthlyPoints),
    index("idx_user_profile_global_rank").on(table.globalRank),
    index("idx_user_profile_monthly_rank").on(table.monthlyRank),
  ]
);

export const achievementDefinition = pgTable(
  "achievement_definition",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    description: text("description").notNull(),
    descriptionEn: text("description_en"),
    type: achievementTypeEnum("type").notNull(),
    badgeTier: badgeTierEnum("badge_tier").notNull(),
    requiredCount: integer("required_count"),
    bonusPoints: integer("bonus_points").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    iconUrl: text("icon_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_achievement_def_type").on(table.type),
    index("idx_achievement_def_badge_tier").on(table.badgeTier),
    index("idx_achievement_def_sort_order").on(table.sortOrder),
  ]
);

export const userAchievement = pgTable(
  "user_achievement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userProfileId: uuid("user_profile_id")
      .notNull()
      .references(() => userProfile.id, { onDelete: "cascade" }),
    achievementDefinitionId: uuid("achievement_definition_id")
      .notNull()
      .references(() => achievementDefinition.id, { onDelete: "cascade" }),
    currentProgress: integer("current_progress").notNull().default(0),
    requiredProgress: integer("required_progress").notNull(),
    progressPercentage: real("progress_percentage").notNull().default(0),
    isUnlocked: boolean("is_unlocked").notNull().default(false),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    progressMetadata: text("progress_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_user_achievement_unique").on(
      table.userProfileId,
      table.achievementDefinitionId
    ),
    index("idx_user_achievement_user").on(table.userProfileId),
    index("idx_user_achievement_unlocked").on(table.isUnlocked),
  ]
);

export const checkIn = pgTable(
  "check_in",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userProfileId: uuid("user_profile_id")
      .notNull()
      .references(() => userProfile.id, { onDelete: "cascade" }),
    masjidId: text("masjid_id").notNull(),
    masjidName: text("masjid_name").notNull(),

    // Check-in details
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull().defaultNow(),
    checkInLat: real("check_in_lat").notNull(),
    checkInLng: real("check_in_lng").notNull(),

    // Check-out details
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    checkOutLat: real("check_out_lat"),
    checkOutLng: real("check_out_lng"),

    status: checkInStatusEnum("status").notNull().default("checked_in"),

    // Points breakdown
    basePoints: integer("base_points").notNull().default(0),
    bonusPoints: integer("bonus_points").notNull().default(0),
    actualPointsEarned: integer("actual_points_earned").notNull().default(0),

    checkoutInProximity: boolean("checkout_in_proximity"),
    durationMinutes: integer("duration_minutes"),

    // Context flags
    isPrayerTime: boolean("is_prayer_time").notNull().default(false),
    prayerName: text("prayer_name"),
    isFirstVisitToMasjid: boolean("is_first_visit_to_masjid").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_check_in_user").on(table.userProfileId),
    index("idx_check_in_masjid").on(table.masjidId),
    index("idx_check_in_status").on(table.status),
    index("idx_check_in_check_in_at").on(table.checkInAt),
    index("idx_check_in_user_status").on(table.userProfileId, table.status),
  ]
);

export const dailyMasjidStats = pgTable(
  "daily_masjid_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    masjidId: text("masjid_id").notNull(),
    date: timestamp("date", { withTimezone: true }).notNull(),
    visitorCount: integer("visitor_count").notNull().default(0),
    uniqueVisitorCount: integer("unique_visitor_count").notNull().default(0),
    totalPointsAwarded: integer("total_points_awarded").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_daily_masjid_stats_unique").on(table.masjidId, table.date),
    index("idx_daily_masjid_stats_date").on(table.date),
    index("idx_daily_masjid_stats_masjid").on(table.masjidId),
  ]
);

export const monthlyLeaderboardSnapshot = pgTable(
  "monthly_leaderboard_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: text("month").notNull(),
    userProfileId: uuid("user_profile_id")
      .notNull()
      .references(() => userProfile.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    totalPoints: integer("total_points").notNull(),
    masjidsVisited: integer("masjids_visited").notNull(),
    displayName: text("display_name").notNull(),
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_monthly_leaderboard_unique").on(table.month, table.userProfileId),
    index("idx_monthly_leaderboard_month").on(table.month),
    index("idx_monthly_leaderboard_rank").on(table.month, table.rank),
  ]
);

// ============ Relations ============

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

// ============ Type Exports ============

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
