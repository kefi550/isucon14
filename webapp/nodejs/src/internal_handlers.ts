import type { Context } from "hono";
import type { Environment } from "./types/hono.js";
import type { RowDataPacket } from "mysql2";
import type { Chair, Ride } from "./types/models.js";

// このAPIをインスタンス内から一定間隔で叩かせることで、椅子とライドをマッチングさせる
export const internalGetMatching = async (ctx: Context<Environment>) => {
  // MEMO: 一旦最も待たせているリクエストに適当な空いている椅子マッチさせる実装とする。おそらくもっといい方法があるはず…
  try {
    await ctx.var.dbConn.beginTransaction();

    const [[ride]] = await ctx.var.dbConn.query<Array<Ride & RowDataPacket>>(
      "SELECT * FROM rides WHERE chair_id IS NULL ORDER BY created_at LIMIT 1",
    );
    if (!ride) {
      return ctx.body(null, 204);
    }
    const [chairs] = await ctx.var.dbConn.query<Array<Chair & RowDataPacket>>(
      `
        SELECT
          c.*
        FROM
          chairs c
        WHERE
          c.is_active = TRUE
          AND NOT EXISTS (
            SELECT
              1
            FROM
              rides r
              INNER JOIN latest_ride_statuses rs ON r.id = rs.ride_id
            WHERE
              r.chair_id = c.id
              AND rs.status <> 'COMPLETED'
          )
        ORDER BY
          RAND()
        LIMIT 1
      `,
      [ride.pickup_latitude, ride.pickup_longitude],
    );

    console.log("=================== chairs =========================")
    console.log(chairs)
    console.log("===============================================")
    if (!!chairs.length) {
      await ctx.var.dbConn.query("UPDATE rides SET chair_id = ? WHERE id = ?", [
        chairs[0].id,
        ride.id,
      ]);
    }

    await ctx.var.dbConn.commit();
  } catch (e) {
    await ctx.var.dbConn.rollback();
    console.error("===============================================")
    console.error(e)
    console.error("===============================================")
  } finally {
    return ctx.body(null, 204);
  }
};
