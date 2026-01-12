import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { Resource } from "sst";
import { expo } from "@better-auth/expo";

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "pg",
    }),
    baseURL: Resource.Api.url,
    socialProviders: {
        google: {
            clientId: Resource.GoogleClientId.value,
            clientSecret: Resource.GoogleClientSecret.value,
        },
    },
    plugins: [expo()]
});