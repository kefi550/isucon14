import { serve } from "@hono/node-server";
import cluster from "cluster";
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import {
  appGetNearbyChairs,
  appGetNotification,
  appGetRides,
  appPostPaymentMethods,
  appPostRideEvaluatation,
  appPostRides,
  appPostRidesEstimatedFare,
  appPostUsers,
} from "./app_handlers.js";
import {
  chairGetNotification,
  chairPostActivity,
  chairPostChairs,
  chairPostCoordinate,
  chairPostRideStatus,
} from "./chair_handlers.js";
import {
  appAuthMiddleware,
  chairAuthMiddleware,
  ownerAuthMiddleware,
} from "./middlewares.js";
import {
  ownerGetChairs,
  ownerGetSales,
  ownerPostOwners,
} from "./owner_handlers.js";
import type { Environment } from "./types/hono.js";
import { execSync } from "node:child_process";
import { internalGetMatching } from "./internal_handlers.js";
import { createPool, type RowDataPacket } from "mysql2/promise";
import { type Chair, type ChairLocation } from "./types/models.js";

const pool = createPool({
  host: process.env.ISUCON_DB_HOST || "127.0.0.1",
  port: Number(process.env.ISUCON_DB_PORT || "3306"),
  user: process.env.ISUCON_DB_USER || "isucon",
  password: process.env.ISUCON_DB_PASSWORD || "isucon",
  database: process.env.ISUCON_DB_NAME || "isuride",
  timezone: "+00:00",
});

const app = new Hono<Environment>();
app.use(
  createMiddleware<Environment>(async (ctx, next) => {
    const connection = await pool.getConnection();
    ctx.set("dbConn", connection);
    try {
      await next();
    } finally {
      await connection.rollback();
      pool.releaseConnection(connection);
    }
  }),
);

app.post("/api/initialize", postInitialize);

// app handlers
app.post("/api/app/users", appPostUsers);

app.post("/api/app/payment-methods", appAuthMiddleware, appPostPaymentMethods);
app.get("/api/app/rides", appAuthMiddleware, appGetRides);
app.post("/api/app/rides", appAuthMiddleware, appPostRides);
app.post(
  "/api/app/rides/estimated-fare",
  appAuthMiddleware,
  appPostRidesEstimatedFare,
);
app.post(
  "/api/app/rides/:ride_id/evaluation",
  appAuthMiddleware,
  appPostRideEvaluatation,
);
app.get("/api/app/notification", appAuthMiddleware, appGetNotification);
app.get("/api/app/nearby-chairs", appAuthMiddleware, appGetNearbyChairs);

// owner handlers
app.post("/api/owner/owners", ownerPostOwners);

app.get("/api/owner/sales", ownerAuthMiddleware, ownerGetSales);
app.get("/api/owner/chairs", ownerAuthMiddleware, ownerGetChairs);

// chair handlers
app.post("/api/chair/chairs", chairPostChairs);

app.post("/api/chair/activity", chairAuthMiddleware, chairPostActivity);
app.post("/api/chair/coordinate", chairAuthMiddleware, chairPostCoordinate);
app.get("/api/chair/notification", chairAuthMiddleware, chairGetNotification);
app.post(
  "/api/chair/rides/:ride_id/status",
  chairAuthMiddleware,
  chairPostRideStatus,
);

// internal handlers
app.get("/api/internal/matching", internalGetMatching);

const port = 8080;

// 2コアでclusterを立てる
if (cluster.isPrimary) {
  for (let i = 0; i < 2; i++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  serve(
    {
      fetch: app.fetch,
      port,
    },
    (addr) => {
      console.log(`Server is running on http://localhost:${addr.port}`);
    },
  );
}

async function postInitialize(ctx: Context<Environment>) {
  const body = await ctx.req.json<{ payment_server: string }>();
  try {
    execSync("../sql/init.sh", { stdio: "inherit" });
  } catch (error) {
    return ctx.text(`Failed to initialize\n${error}`, 500);
  }
  try {
    await ctx.var.dbConn.query(
      "UPDATE settings SET value = ? WHERE name = 'payment_gateway_url'",
      [body.payment_server],
    );

    const [chairLocations] = await ctx.var.dbConn.query<Array<ChairLocation & RowDataPacket>>(`
      SELECT
        *
      FROM
        chair_locations
    `)

    // chair_idごとにchair_locations の array を作成, 
    const chairLocationsMap = chairLocations.reduce((acc, cur) => {
      if (!acc[cur.chair_id]) {
        acc[cur.chair_id] = [];
      }
      acc[cur.chair_id].push(cur);
      return acc;
    }, {} as { [key: string]: Array<ChairLocation & RowDataPacket> });

    // chairLocationsMap の中身のarrayをcreatedAtの昇順にソート
    for (const chairId in chairLocationsMap) {
      chairLocationsMap[chairId].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    }

    // sort 済みのchairLocationsMap を使って、以下を求める
    // - 合計の移動距離
    // - 最新の緯度
    // - 最新の経度
    // - 最新のcreated_at
    const insertDataMap = Object.entries(chairLocationsMap).reduce((prev, [chairId, locations]) => {
      const latest = locations.at(-1);
      if(!latest) throw new Error("latest location is not found");

      const sumDistance = locations.reduce((acc, cur, idx) => {
        if (idx === 0) return 0;
        const prev = locations[idx - 1];
        return acc + Math.abs(cur.latitude - prev.latitude) + Math.abs(cur.longitude - prev.longitude);
      }, 0);


      const latestLatitude = latest.latitude;
      const latestLongitude = latest.longitude;
      const latestCreatedAt = latest.created_at;

      return {
        ...prev,
        [chairId]: {
          sumDistance,
          latestLatitude,
          latestLongitude,
          latestCreatedAt
        }
      }
    }, {} as { [key: string]: { sumDistance: number, latestLatitude: number, latestLongitude: number, latestCreatedAt: Date} });


    // chair_location_statisticsにbulk insert
    const insertData = Object.entries(insertDataMap).map(([chairId, data]) => {
      return [
        chairId,
        data.latestLatitude,
        data.latestLongitude,
        data.sumDistance,
        data.latestCreatedAt
      ]
    });

    await ctx.var.dbConn.query(
      `
      INSERT INTO chair_location_statistics
      (chair_id, latest_latitude, latest_longitude, sum_distance, updated_at)
      VALUES ?
      `,
      [insertData]
    )



  } catch (error) {
    return ctx.text(`Internal Server Error\n${error}`, 500);
  }
  return ctx.json({ language: "node" });
}
