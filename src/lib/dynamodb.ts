import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
export const dynamodb = DynamoDBDocumentClient.from(client);
export const TABLE_NAME = Resource.MasjidDirectory.name;
