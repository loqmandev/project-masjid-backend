import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import {
  getMasjidById,
  checkinToMasjid,
  getNearbyMasjids,
  getCheckinEligibleMasjids,
  getMasjidsByState,
  getMasjidsByDistrict,
  searchMasjidsByName,
} from "./services/masjid.service";
import {
  getOrCreateUserProfile,
  getUserProfileWithUser,
  updateUserProfile,
} from "./services/user.service";
import {
  performCheckin,
  performCheckout,
  getActiveCheckinByUserId,
  getCheckinHistory,
  getMasjidStats,
} from "./services/checkin.service";
import {
  getAllAchievements,
  getUserAchievements,
} from "./services/achievement.service";
import {
  getMonthlyLeaderboard,
  getGlobalLeaderboard,
  getUserRank,
} from "./services/leaderboard.service";
import { auth } from "./lib/auth";

// Auth middleware helper
async function requireAuth(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  return session;
}

const app = new Hono();

// better auth handler
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "masjid-go-api" }));

// 2. Get nearby masjids (default 5km, max 5km)
app.get("/masjids/nearby", async (c) => {
  const lat = parseFloat(c.req.query("lat") || "0");
  const lng = parseFloat(c.req.query("lng") || "0");
  const radius = parseFloat(c.req.query("radius") || "5");

  if (!lat || !lng) {
    return c.json({ error: "lat and lng are required" }, 400);
  }

  const masjids = await getNearbyMasjids(lat, lng, radius);

  return c.json(masjids);
});

// 2b. Get masjids available for check-in (within ~100m proximity)
app.get("/masjids/checkin", async (c) => {
  const lat = parseFloat(c.req.query("lat") || "0");
  const lng = parseFloat(c.req.query("lng") || "0");

  if (!lat || !lng) {
    return c.json({ error: "lat and lng are required" }, 400);
  }

  const masjids = await getCheckinEligibleMasjids(lat, lng);
  return c.json(masjids);
});

// 5. Search masjids by name (must be before /:id to avoid param matching)
app.get("/masjids/search", async (c) => {
  const q = c.req.query("q") || "";
  const limit = parseInt(c.req.query("limit") || "20");

  if (!q) {
    return c.json({ error: "Search query 'q' is required" }, 400);
  }

  const masjids = await searchMasjidsByName(q, limit);
  return c.json(masjids);
});

// 1. Get masjid by ID
app.get("/masjids/:id", async (c) => {
  const masjid = await getMasjidById(c.req.param("id"));
  if (!masjid) return c.json({ error: "Masjid not found" }, 404);
  return c.json(masjid);
});

// 1b. Check-in to a specific masjid (authenticated)
app.post("/masjids/:id/checkin", async (c) => {
  const session = await requireAuth(c);
  const masjidId = c.req.param("id");
  const body = await c.req.json<{ lat: number; lng: number }>();

  if (!body.lat || !body.lng) {
    return c.json({ success: false, message: "lat and lng are required" }, 400);
  }

  const result = await performCheckin(
    session.user.id,
    masjidId,
    body.lat,
    body.lng
  );

  if (!result.success) {
    const status = result.message === "Masjid not found" ? 404 : 400;
    return c.json(result, status);
  }

  return c.json(result);
});

// 1c. Check-out from current masjid (authenticated)
app.post("/masjids/:id/checkout", async (c) => {
  const session = await requireAuth(c);
  const body = await c.req.json<{ lat: number; lng: number }>();

  if (!body.lat || !body.lng) {
    return c.json({ success: false, message: "lat and lng are required" }, 400);
  }

  const result = await performCheckout(session.user.id, body.lat, body.lng);

  if (!result.success) {
    return c.json(result, 400);
  }

  return c.json(result);
});

// 1d. Get masjid stats
app.get("/masjids/:id/stats", async (c) => {
  const masjidId = c.req.param("id");
  const stats = await getMasjidStats(masjidId);
  return c.json(stats);
});

// 3. Get masjids by state
app.get("/states/:stateCode/masjids", async (c) => {
  const masjids = await getMasjidsByState(c.req.param("stateCode"));
  return c.json(masjids);
});

// 4. Get masjids by district
app.get("/states/:stateCode/districts/:districtCode/masjids", async (c) => {
  const masjids = await getMasjidsByDistrict(
    c.req.param("stateCode"),
    c.req.param("districtCode")
  );
  return c.json(masjids);
});

// ============ User Profile Endpoints ============

// Get current user's gamification profile
app.get("/api/user/profile", async (c) => {
  const session = await requireAuth(c);
  const profile = await getUserProfileWithUser(session.user.id);

  if (!profile) {
    // Create profile if doesn't exist
    const newProfile = await getOrCreateUserProfile(session.user.id);
    const fullProfile = await getUserProfileWithUser(session.user.id);
    return c.json(fullProfile);
  }

  // Include user's rank
  const rank = await getUserRank(session.user.id);

  return c.json({
    ...profile,
    rank,
  });
});

// Update user profile settings
app.put("/api/user/profile", async (c) => {
  const session = await requireAuth(c);
  const body = await c.req.json<{
    showFullNameInLeaderboard?: boolean;
    leaderboardAlias?: string;
  }>();

  const updated = await updateUserProfile(session.user.id, body);

  if (!updated) {
    return c.json({ error: "Profile not found" }, 404);
  }

  return c.json(updated);
});

// ============ User Check-in Endpoints ============

// Get user's check-in history
app.get("/api/user/checkins", async (c) => {
  const session = await requireAuth(c);
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");

  const checkins = await getCheckinHistory(session.user.id, limit, offset);
  return c.json(checkins);
});

// Get current active check-in
app.get("/api/user/checkins/active", async (c) => {
  const session = await requireAuth(c);
  const activeCheckin = await getActiveCheckinByUserId(session.user.id);

  if (!activeCheckin) {
    return c.json({ active: false, checkIn: null });
  }

  return c.json({ active: true, checkIn: activeCheckin });
});

// ============ Achievement Endpoints ============

// Get all achievement definitions (public)
app.get("/api/achievements", async (c) => {
  const achievements = await getAllAchievements();
  return c.json(achievements);
});

// Get user's achievement progress
app.get("/api/user/achievements", async (c) => {
  const session = await requireAuth(c);
  const achievements = await getUserAchievements(session.user.id);
  return c.json(achievements);
});

// ============ Leaderboard Endpoints ============

// Get monthly leaderboard (public)
app.get("/api/leaderboard/monthly", async (c) => {
  const limit = parseInt(c.req.query("limit") || "8");

  // Optionally include current user context if authenticated
  let currentUserId: string | undefined;
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    currentUserId = session?.user?.id;
  } catch {
    // Not authenticated, continue without user context
  }

  const leaderboard = await getMonthlyLeaderboard(limit, currentUserId);
  return c.json(leaderboard);
});

// Get global leaderboard with pagination (public)
app.get("/api/leaderboard/global", async (c) => {
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");

  // Optionally include current user context if authenticated
  let currentUserId: string | undefined;
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    currentUserId = session?.user?.id;
  } catch {
    // Not authenticated, continue without user context
  }

  const result = await getGlobalLeaderboard(limit, offset, currentUserId);
  return c.json(result);
});

export const handler = handle(app);
