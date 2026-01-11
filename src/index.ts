import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import {
  getMasjidById,
  getNearbyMasjids,
  getCheckinEligibleMasjids,
  getMasjidsByState,
  getMasjidsByDistrict,
  searchMasjidsByName,
} from "./services/masjid.service";

const app = new Hono();

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

export const handler = handle(app);
