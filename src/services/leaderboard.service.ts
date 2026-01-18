import { eq, desc, asc, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  userProfile,
  user,
  monthlyLeaderboardSnapshot,
} from "../db/schema";

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  points: number;
  masjidsVisited: number;
  isCurrentUser?: boolean;
}

// censor name
function censorName(name: string): string {
  if (name.length <= 2) {
    return name[0] + "*".repeat(name.length - 1);
  }
  return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
}

// Get monthly leaderboard
export async function getMonthlyLeaderboard(
  limit: number = 8,
  currentUserId?: string
): Promise<LeaderboardEntry[]> {
  const results = await db
    .select({
      id: userProfile.id,
      userId: userProfile.userId,
      monthlyPoints: userProfile.monthlyPoints,
      uniqueMasjidsVisited: userProfile.uniqueMasjidsVisited,
      showFullNameInLeaderboard: userProfile.showFullNameInLeaderboard,
      leaderboardAlias: userProfile.leaderboardAlias,
      userName: user.name,
    })
    .from(userProfile)
    .innerJoin(user, eq(userProfile.userId, user.id))
    .orderBy(desc(userProfile.monthlyPoints))
    .limit(limit);

  return results.map((row, index) => ({
    rank: index + 1,
    displayName: row.leaderboardAlias || censorName(row.userName),
    points: row.monthlyPoints,
    masjidsVisited: row.uniqueMasjidsVisited,
    isCurrentUser: currentUserId ? row.userId === currentUserId : undefined,
  }));
}

// Get global leaderboard (by total points)
export async function getGlobalLeaderboard(
  limit: number = 20,
  offset: number = 0,
  currentUserId?: string
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  const results = await db
    .select({
      id: userProfile.id,
      userId: userProfile.userId,
      totalPoints: userProfile.totalPoints,
      uniqueMasjidsVisited: userProfile.uniqueMasjidsVisited,
      showFullNameInLeaderboard: userProfile.showFullNameInLeaderboard,
      leaderboardAlias: userProfile.leaderboardAlias,
      userName: user.name,
    })
    .from(userProfile)
    .innerJoin(user, eq(userProfile.userId, user.id))
    .orderBy(desc(userProfile.totalPoints))
    .limit(limit)
    .offset(offset);

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(userProfile);

  const entries = results.map((row, index) => ({
    rank: offset + index + 1,
    displayName: row.leaderboardAlias || censorName(row.userName),
    points: row.totalPoints,
    masjidsVisited: row.uniqueMasjidsVisited,
    isCurrentUser: currentUserId ? row.userId === currentUserId : undefined,
  }));

  return {
    entries,
    total: Number(countResult[0]?.count || 0),
  };
}

// Get user's rank
export async function getUserRank(
  userId: string
): Promise<{ globalRank: number | null; monthlyRank: number | null }> {
  const profile = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  if (profile.length === 0) {
    return { globalRank: null, monthlyRank: null };
  }

  const userPoints = profile[0].totalPoints;
  const userMonthlyPoints = profile[0].monthlyPoints;

  // Calculate global rank (users with more points + 1)
  const globalRankResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(userProfile)
    .where(sql`${userProfile.totalPoints} > ${userPoints}`);

  // Calculate monthly rank
  const monthlyRankResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(userProfile)
    .where(sql`${userProfile.monthlyPoints} > ${userMonthlyPoints}`);

  return {
    globalRank: (Number(globalRankResult[0]?.count || 0) + 1),
    monthlyRank: (Number(monthlyRankResult[0]?.count || 0) + 1),
  };
}

// Recalculate and update cached ranks
export async function recalculateRanks(): Promise<void> {
  // Update global ranks
  const allProfiles = await db
    .select({ id: userProfile.id, totalPoints: userProfile.totalPoints })
    .from(userProfile)
    .orderBy(desc(userProfile.totalPoints));

  for (let i = 0; i < allProfiles.length; i++) {
    await db
      .update(userProfile)
      .set({ globalRank: i + 1, updatedAt: new Date() })
      .where(eq(userProfile.id, allProfiles[i].id));
  }

  // Update monthly ranks
  const monthlyProfiles = await db
    .select({ id: userProfile.id, monthlyPoints: userProfile.monthlyPoints })
    .from(userProfile)
    .orderBy(desc(userProfile.monthlyPoints));

  for (let i = 0; i < monthlyProfiles.length; i++) {
    await db
      .update(userProfile)
      .set({ monthlyRank: i + 1, updatedAt: new Date() })
      .where(eq(userProfile.id, monthlyProfiles[i].id));
  }
}

// Create monthly snapshot (for end of month)
export async function createMonthlySnapshot(): Promise<void> {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const profiles = await db
    .select({
      profileId: userProfile.id,
      monthlyPoints: userProfile.monthlyPoints,
      uniqueMasjidsVisited: userProfile.uniqueMasjidsVisited,
      showFullNameInLeaderboard: userProfile.showFullNameInLeaderboard,
      leaderboardAlias: userProfile.leaderboardAlias,
      userName: user.name,
    })
    .from(userProfile)
    .innerJoin(user, eq(userProfile.userId, user.id))
    .orderBy(desc(userProfile.monthlyPoints));

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];

    await db.insert(monthlyLeaderboardSnapshot).values({
      month,
      userProfileId: profile.profileId,
      rank: i + 1,
      totalPoints: profile.monthlyPoints,
      masjidsVisited: profile.uniqueMasjidsVisited,
      displayName: profile.leaderboardAlias || censorName(profile.userName),
      isAnonymous: !profile.showFullNameInLeaderboard,
    });
  }
}

// Get historical monthly leaderboard
export async function getMonthlyLeaderboardHistory(
  month: string,
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  const results = await db
    .select()
    .from(monthlyLeaderboardSnapshot)
    .where(eq(monthlyLeaderboardSnapshot.month, month))
    .orderBy(asc(monthlyLeaderboardSnapshot.rank))
    .limit(limit);

  return results.map((row) => ({
    rank: row.rank,
    displayName: row.displayName,
    points: row.totalPoints,
    masjidsVisited: row.masjidsVisited,
  }));
}
