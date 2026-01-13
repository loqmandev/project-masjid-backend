/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app(input) {
    return {
      name: "project-masjid-backend",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        aws: {
          region: "ap-southeast-1",
          profile: "hakimtech",
        },
        cloudflare: "6.12.0",
      },
    };
  },
  async run() {
    const stage = $app.stage;
    const apiDomain = stage === "production" ? "api.jejakmasjid.my" : undefined;
    // Secrets
    const databaseUrl = new sst.Secret("DatabaseUrl");
    const googleClientId = new sst.Secret("GoogleClientId");
    const googleClientSecret = new sst.Secret("GoogleClientSecret");
    // DynamoDB Table for Masjid Directory
    const masjidTable = new sst.aws.Dynamo("MasjidDirectory", {
      fields: {
        PK: "string",
        SK: "string",
        GSI1PK: "string",
        GSI1SK: "string",
        GSI2PK: "string",
        GSI2SK: "string",
        GSI3PK: "string",
        GSI3SK: "string",
      },
      primaryIndex: { hashKey: "PK", rangeKey: "SK" },
      globalIndexes: {
        GSI1: { hashKey: "GSI1PK", rangeKey: "GSI1SK" },
        GSI2: { hashKey: "GSI2PK", rangeKey: "GSI2SK" },
        GSI3: { hashKey: "GSI3PK", rangeKey: "GSI3SK" },
      },
    });
    // API Gateway V2 + Hono Lambda
    const api = new sst.aws.ApiGatewayV2("Api", {
      domain: apiDomain
        ? {
            name: apiDomain,
            dns: sst.cloudflare.dns(),
          }
        : undefined,
    });
    api.route("$default", {
      handler: "src/index.handler",
      link: [api, masjidTable, databaseUrl, googleClientId, googleClientSecret],
    });
    return {
      api: api.url,
      table: masjidTable.name,
    };
  },
});
