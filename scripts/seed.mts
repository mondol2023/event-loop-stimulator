import { connectDb, disconnectDb } from "@/server/db/connection";
import { seed } from "@/server/db/seed";
import { getEnv } from "@/server/env";

// Run with: npm run seed  (tsx --conditions=react-server, so `server-only` resolves).
async function main(): Promise<void> {
  const env = getEnv();
  await connectDb(env.MONGODB_URI);
  const adminEmail = env.ADMIN_BOOTSTRAP_EMAIL;
  const result = await seed(adminEmail === undefined ? {} : { adminEmail });
  console.log(`Roles upserted: ${result.rolesUpserted}`);
  if (adminEmail === undefined) {
    console.log("Admin promotion: skipped (ADMIN_BOOTSTRAP_EMAIL is not set)");
  } else if (result.promotedAdmin) {
    console.log("Admin promotion: user promoted to admin");
  } else {
    console.log("Admin promotion: nothing to do (no such user yet, or already admin)");
  }
}

main()
  .then(() => disconnectDb())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await disconnectDb().catch(() => undefined);
    process.exitCode = 1;
  });
