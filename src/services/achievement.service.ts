import { eq, and, asc } from "drizzle-orm";
import { db } from "../lib/db";
import {
  achievementDefinition,
  userAchievement,
  userProfile,
  type AchievementDefinition,
  type UserAchievement,
} from "../db/schema";

// Get all active achievement definitions
export async function getAllAchievements(): Promise<AchievementDefinition[]> {
  return db
    .select()
    .from(achievementDefinition)
    .where(eq(achievementDefinition.isActive, true))
    .orderBy(asc(achievementDefinition.sortOrder));
}

// Get user's achievement progress
export async function getUserAchievements(
  userId: string
): Promise<
  Array<{
    achievement: AchievementDefinition;
    progress: UserAchievement | null;
  }>
> {
  // Get user profile
  const profile = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  if (profile.length === 0) {
    // Return all achievements with null progress
    const achievements = await getAllAchievements();
    return achievements.map((achievement) => ({
      achievement,
      progress: null,
    }));
  }

  const profileId = profile[0].id;

  // Get all achievements with user progress
  const achievements = await getAllAchievements();
  const userProgress = await db
    .select()
    .from(userAchievement)
    .where(eq(userAchievement.userProfileId, profileId));

  // Map achievements with progress
  const progressMap = new Map(
    userProgress.map((p) => [p.achievementDefinitionId, p])
  );

  return achievements.map((achievement) => ({
    achievement,
    progress: progressMap.get(achievement.id) || null,
  }));
}

// Update achievement progress after check-in
export async function updateAchievementProgress(
  profileId: string,
  uniqueMasjidsVisited: number
): Promise<void> {
  // Get all explorer achievements
  const explorerAchievements = await db
    .select()
    .from(achievementDefinition)
    .where(
      and(
        eq(achievementDefinition.type, "explorer"),
        eq(achievementDefinition.isActive, true)
      )
    )
    .orderBy(asc(achievementDefinition.sortOrder));

  for (const achievement of explorerAchievements) {
    if (!achievement.requiredCount) continue;

    // Get or create user achievement record
    const existing = await db
      .select()
      .from(userAchievement)
      .where(
        and(
          eq(userAchievement.userProfileId, profileId),
          eq(userAchievement.achievementDefinitionId, achievement.id)
        )
      )
      .limit(1);

    const currentProgress = uniqueMasjidsVisited;
    const requiredProgress = achievement.requiredCount;
    const progressPercentage = Math.min(
      (currentProgress / requiredProgress) * 100,
      100
    );
    const isUnlocked = currentProgress >= requiredProgress;

    if (existing.length > 0) {
      // Update existing record
      const record = existing[0];

      // If already unlocked, skip
      if (record.isUnlocked) continue;

      await db
        .update(userAchievement)
        .set({
          currentProgress,
          progressPercentage,
          isUnlocked,
          unlockedAt: isUnlocked ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(userAchievement.id, record.id));

      // If just unlocked, award bonus points
      if (isUnlocked && !record.isUnlocked) {
        await awardAchievementBonus(profileId, achievement.bonusPoints);
      }
    } else {
      // Create new record
      await db.insert(userAchievement).values({
        userProfileId: profileId,
        achievementDefinitionId: achievement.id,
        currentProgress,
        requiredProgress,
        progressPercentage,
        isUnlocked,
        unlockedAt: isUnlocked ? new Date() : null,
      });

      // If unlocked on creation, award bonus points
      if (isUnlocked) {
        await awardAchievementBonus(profileId, achievement.bonusPoints);
      }
    }
  }
}

// Award achievement bonus points
async function awardAchievementBonus(
  profileId: string,
  bonusPoints: number
): Promise<void> {
  const profile = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.id, profileId))
    .limit(1);

  if (profile.length === 0) return;

  await db
    .update(userProfile)
    .set({
      totalPoints: profile[0].totalPoints + bonusPoints,
      monthlyPoints: profile[0].monthlyPoints + bonusPoints,
      achievementCount: profile[0].achievementCount + 1,
      updatedAt: new Date(),
    })
    .where(eq(userProfile.id, profileId));
}

// Initialize user achievements (create progress records for all achievements)
export async function initializeUserAchievements(
  profileId: string
): Promise<void> {
  const achievements = await getAllAchievements();

  for (const achievement of achievements) {
    const existing = await db
      .select()
      .from(userAchievement)
      .where(
        and(
          eq(userAchievement.userProfileId, profileId),
          eq(userAchievement.achievementDefinitionId, achievement.id)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(userAchievement).values({
        userProfileId: profileId,
        achievementDefinitionId: achievement.id,
        currentProgress: 0,
        requiredProgress: achievement.requiredCount || 1,
        progressPercentage: 0,
        isUnlocked: false,
      });
    }
  }
}
