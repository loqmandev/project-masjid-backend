import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  checkIn,
  userProfile,
  dailyMasjidStats,
  type CheckIn,
  type NewCheckIn,
} from "../db/schema";
import { getMasjidById } from "./masjid.service";
import { haversineDistance } from "../utils/geo";
import { getOrCreateUserProfile, updateUserStats } from "./user.service";
import { updateAchievementProgress } from "./achievement.service";

// Points configuration
const POINTS = {
  BASE_VISIT_COMPLETED: 10,
  BASE_VISIT_INCOMPLETE: 5,
  PRAYER_TIME_BONUS: 10,
  FIRST_VISIT_BONUS: 5,
};

// Perform check-in
export async function performCheckin(
  userId: string,
  masjidId: string,
  lat: number,
  lng: number
): Promise<{
  success: boolean;
  checkIn?: CheckIn;
  message: string;
}> {
  // Get or create user profile
  const profile = await getOrCreateUserProfile(userId);

  // Check for active check-in
  const activeCheckin = await getActiveCheckin(profile.id);
  if (activeCheckin) {
    return {
      success: false,
      message: "You already have an active check-in. Please checkout first.",
    };
  }

  // Get masjid data from DynamoDB
  const masjid = await getMasjidById(masjidId);
  if (!masjid) {
    return { success: false, message: "Masjid not found" };
  }

  // Validate proximity
  const masjidLat = masjid.lat as number;
  const masjidLng = masjid.lng as number;
  const checkinRadiusM = (masjid.checkinRadiusM as number) || 100;

  const distanceKm = haversineDistance(lat, lng, masjidLat, masjidLng);
  const distanceM = distanceKm * 1000;

  if (distanceM > checkinRadiusM) {
    return {
      success: false,
      message: `Too far from masjid. You are ${Math.round(distanceM)}m away, must be within ${checkinRadiusM}m`,
    };
  }

  // Check if first visit to this masjid
  const previousVisits = await db
    .select({ count: sql<number>`count(*)` })
    .from(checkIn)
    .where(
      and(eq(checkIn.userProfileId, profile.id), eq(checkIn.masjidId, masjidId))
    );

  const isFirstVisit = Number(previousVisits[0].count) === 0;

  // TODO: Check if prayer time (would need prayer time API/calculation)
  const isPrayerTime = false;
  const prayerName = null;

  // Calculate base points (will finalize on checkout)
  const basePoints = POINTS.BASE_VISIT_COMPLETED;
  const bonusPoints =
    (isFirstVisit ? POINTS.FIRST_VISIT_BONUS : 0) +
    (isPrayerTime ? POINTS.PRAYER_TIME_BONUS : 0);

  // Create check-in record
  const newCheckin: NewCheckIn = {
    userProfileId: profile.id,
    masjidId,
    masjidName: masjid.name as string,
    checkInLat: lat,
    checkInLng: lng,
    status: "checked_in",
    basePoints,
    bonusPoints,
    actualPointsEarned: 0, // Finalized on checkout
    isPrayerTime,
    prayerName,
    isFirstVisitToMasjid: isFirstVisit,
  };

  const created = await db.insert(checkIn).values(newCheckin).returning();

  return {
    success: true,
    checkIn: created[0],
    message: "Check-in successful",
  };
}

// Perform check-out
export async function performCheckout(
  userId: string,
  lat: number,
  lng: number
): Promise<{
  success: boolean;
  checkIn?: CheckIn;
  pointsEarned?: number;
  message: string;
}> {
  // Get user profile
  const profile = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  if (profile.length === 0) {
    return { success: false, message: "User profile not found" };
  }

  const profileId = profile[0].id;

  // Get active check-in
  const active = await getActiveCheckin(profileId);
  if (!active) {
    return { success: false, message: "No active check-in found" };
  }

  // Get masjid for proximity check
  const masjid = await getMasjidById(active.masjidId);
  const checkinRadiusM = masjid ? ((masjid.checkinRadiusM as number) || 100) : 100;

  // Check checkout proximity
  const masjidLat = masjid?.lat as number;
  const masjidLng = masjid?.lng as number;
  const distanceKm = haversineDistance(lat, lng, masjidLat, masjidLng);
  const distanceM = distanceKm * 1000;
  const checkoutInProximity = distanceM <= checkinRadiusM;

  // Calculate duration
  const checkInTime = new Date(active.checkInAt);
  const checkOutTime = new Date();
  const durationMinutes = Math.floor(
    (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60)
  );

  // Calculate final points
  const status = checkoutInProximity ? "completed" : "incomplete";
  const basePoints = checkoutInProximity
    ? POINTS.BASE_VISIT_COMPLETED
    : POINTS.BASE_VISIT_INCOMPLETE;
  const actualPointsEarned = basePoints + active.bonusPoints;

  // Update check-in record
  const updated = await db
    .update(checkIn)
    .set({
      checkOutAt: checkOutTime,
      checkOutLat: lat,
      checkOutLng: lng,
      status,
      basePoints,
      actualPointsEarned,
      checkoutInProximity,
      durationMinutes,
      updatedAt: checkOutTime,
    })
    .where(eq(checkIn.id, active.id))
    .returning();

  // Update user stats
  await updateUserStats(profileId, actualPointsEarned, active.isFirstVisitToMasjid);

  // Update achievement progress
  const updatedProfile = profile[0];
  const newUniqueMasjids = active.isFirstVisitToMasjid
    ? updatedProfile.uniqueMasjidsVisited + 1
    : updatedProfile.uniqueMasjidsVisited;
  await updateAchievementProgress(profileId, newUniqueMasjids);

  // Update daily masjid stats
  await updateDailyMasjidStats(active.masjidId, actualPointsEarned);

  return {
    success: true,
    checkIn: updated[0],
    pointsEarned: actualPointsEarned,
    message: checkoutInProximity
      ? "Checkout successful! Full points earned."
      : "Checkout completed outside proximity. Partial points earned.",
  };
}

// Get active check-in for user
export async function getActiveCheckin(
  profileId: string
): Promise<CheckIn | null> {
  const result = await db
    .select()
    .from(checkIn)
    .where(
      and(eq(checkIn.userProfileId, profileId), eq(checkIn.status, "checked_in"))
    )
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// Get active check-in by userId
export async function getActiveCheckinByUserId(
  userId: string
): Promise<CheckIn | null> {
  const profile = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  if (profile.length === 0) return null;

  return getActiveCheckin(profile[0].id);
}

// Get check-in history
export async function getCheckinHistory(
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<CheckIn[]> {
  const profile = await db
    .select()
    .from(userProfile)
    .where(eq(userProfile.userId, userId))
    .limit(1);

  if (profile.length === 0) return [];

  return db
    .select()
    .from(checkIn)
    .where(eq(checkIn.userProfileId, profile[0].id))
    .orderBy(desc(checkIn.checkInAt))
    .limit(limit)
    .offset(offset);
}

// Update daily masjid stats
async function updateDailyMasjidStats(
  masjidId: string,
  pointsAwarded: number
): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Try to update existing record
  const existing = await db
    .select()
    .from(dailyMasjidStats)
    .where(
      and(
        eq(dailyMasjidStats.masjidId, masjidId),
        eq(dailyMasjidStats.date, today)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(dailyMasjidStats)
      .set({
        visitorCount: existing[0].visitorCount + 1,
        totalPointsAwarded: existing[0].totalPointsAwarded + pointsAwarded,
        updatedAt: new Date(),
      })
      .where(eq(dailyMasjidStats.id, existing[0].id));
  } else {
    await db.insert(dailyMasjidStats).values({
      masjidId,
      date: today,
      visitorCount: 1,
      uniqueVisitorCount: 1,
      totalPointsAwarded: pointsAwarded,
    });
  }
}

// Get masjid stats
export async function getMasjidStats(masjidId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Today's stats
  const todayStats = await db
    .select()
    .from(dailyMasjidStats)
    .where(
      and(
        eq(dailyMasjidStats.masjidId, masjidId),
        eq(dailyMasjidStats.date, today)
      )
    )
    .limit(1);

  // Total all-time stats
  const allTimeStats = await db
    .select({
      totalVisitors: sql<number>`sum(${dailyMasjidStats.visitorCount})`,
      totalPoints: sql<number>`sum(${dailyMasjidStats.totalPointsAwarded})`,
    })
    .from(dailyMasjidStats)
    .where(eq(dailyMasjidStats.masjidId, masjidId));

  return {
    today: todayStats.length > 0 ? todayStats[0] : null,
    allTime: {
      totalVisitors: allTimeStats[0]?.totalVisitors || 0,
      totalPoints: allTimeStats[0]?.totalPoints || 0,
    },
  };
}
