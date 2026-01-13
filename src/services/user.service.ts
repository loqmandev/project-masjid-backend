import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import { userProfile, user, type UserProfile, type NewUserProfile } from "../db/schema";

// Get or create user profile for gamification
export async function getOrCreateUserProfile(userId: string): Promise<UserProfile> {
  // Check if profile exists
  const existing = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create new profile
  const newProfile: NewUserProfile = {
    userId,
    totalPoints: 0,
    monthlyPoints: 0,
    uniqueMasjidsVisited: 0,
    totalCheckIns: 0,
    achievementCount: 0,
    showFullNameInLeaderboard: true,
    currentStreak: 0,
    longestStreak: 0,
  };

  const created = await db.insert(userProfile).values(newProfile).returning();
  return created[0];
}

// Get user profile by userId
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const result = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// Get user profile with user info (for display)
export async function getUserProfileWithUser(userId: string) {
  const result = await db
    .select({
      profile: userProfile,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(userProfile)
    .innerJoin(user, eq(userProfile.userId, user.id))
    .where(eq(userProfile.userId, userId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// Update user profile settings
export async function updateUserProfile(
  userId: string,
  data: {
    showFullNameInLeaderboard?: boolean;
    leaderboardAlias?: string;
  }
): Promise<UserProfile | null> {
  const result = await db
    .update(userProfile)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(userProfile.userId, userId))
    .returning();

  return result.length > 0 ? result[0] : null;
}

// Update user stats after check-in
export async function updateUserStats(
  profileId: string,
  pointsEarned: number,
  isNewMasjid: boolean
): Promise<void> {
  const profile = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.id, profileId))
    .limit(1);

  if (profile.length === 0) return;

  const current = profile[0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Calculate streak
  let newStreak = current.currentStreak;
  let newLongestStreak = current.longestStreak;

  if (current.lastVisitDate) {
    const lastVisit = new Date(current.lastVisitDate);
    lastVisit.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((today.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff === 1) {
      // Consecutive day
      newStreak = current.currentStreak + 1;
      newLongestStreak = Math.max(newStreak, current.longestStreak);
    } else if (daysDiff > 1) {
      // Streak broken
      newStreak = 1;
    }
    // daysDiff === 0 means same day, don't change streak
  } else {
    // First visit ever
    newStreak = 1;
    newLongestStreak = 1;
  }

  await db
    .update(userProfile)
    .set({
      totalPoints: current.totalPoints + pointsEarned,
      monthlyPoints: current.monthlyPoints + pointsEarned,
      uniqueMasjidsVisited: isNewMasjid
        ? current.uniqueMasjidsVisited + 1
        : current.uniqueMasjidsVisited,
      totalCheckIns: current.totalCheckIns + 1,
      currentStreak: newStreak,
      longestStreak: newLongestStreak,
      lastVisitDate: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userProfile.id, profileId));
}

// Reset monthly points (for scheduled job)
export async function resetMonthlyPoints(): Promise<void> {
  await db.update(userProfile).set({
    monthlyPoints: 0,
    monthlyRank: null,
    updatedAt: new Date(),
  });
}
