import {
  FULFILLMENT_CREATE_MUTATION,
  ORDER_FULFILLMENT_ORDERS_QUERY,
  ASSIGNED_FULFILLMENT_ORDERS_QUERY,
  ACCEPT_FULFILLMENT_REQUEST_MUTATION,
  SHOPIFY_API_VERSION,
  type ShopifyFulfillmentOrderNode,
} from "../domain/shopify";

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export type ShopifyConnectionCreds = {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string | null;
};

export type ShopifyGraphqlClient = {
  graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;
};

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export function createShopifyGraphqlClient(
  connection: ShopifyConnectionCreds,
  fetchImpl: typeof fetch = fetch,
): ShopifyGraphqlClient {
  const apiVersion = connection.apiVersion || SHOPIFY_API_VERSION;
  return {
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const url = `https://${connection.shopDomain}/admin/api/${apiVersion}/graphql.json`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": connection.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });
      const body = (await res.json().catch(() => ({}))) as GraphqlEnvelope<T>;
      if (!res.ok) {
        throw new ShopifyApiError(`Shopify HTTP ${res.status}`, res.status, body);
      }
      if (body.errors?.length) {
        throw new ShopifyApiError(body.errors[0]?.message || "Shopify GraphQL error", res.status, body);
      }
      if (!body.data) {
        throw new ShopifyApiError("Shopify returned no data", res.status, body);
      }
      return body.data;
    },
  };
}

export async function fetchOrderFulfillmentOrders(
  client: ShopifyGraphqlClient,
  orderGid: string,
): Promise<ShopifyFulfillmentOrderNode[]> {
  const data = await client.graphql<{
    order?: { fulfillmentOrders?: { nodes?: ShopifyFulfillmentOrderNode[] } };
  }>(ORDER_FULFILLMENT_ORDERS_QUERY, { id: orderGid });
  return data.order?.fulfillmentOrders?.nodes ?? [];
}

export async function fetchAssignedFulfillmentOrders(
  client: ShopifyGraphqlClient,
): Promise<ShopifyFulfillmentOrderNode[]> {
  const data = await client.graphql<{
    shop?: { assignedFulfillmentOrders?: { nodes?: ShopifyFulfillmentOrderNode[] } };
  }>(ASSIGNED_FULFILLMENT_ORDERS_QUERY);
  return data.shop?.assignedFulfillmentOrders?.nodes ?? [];
}

export async function acceptFulfillmentRequest(
  client: ShopifyGraphqlClient,
  fulfillmentOrderId: string,
  message = "Accepted by Rackline",
): Promise<void> {
  const data = await client.graphql<{
    fulfillmentOrderAcceptFulfillmentRequest?: {
      userErrors?: Array<{ message?: string }>;
    };
  }>(ACCEPT_FULFILLMENT_REQUEST_MUTATION, { id: fulfillmentOrderId, message });
  const errors = data.fulfillmentOrderAcceptFulfillmentRequest?.userErrors ?? [];
  if (errors[0]?.message) {
    throw new ShopifyApiError(errors[0].message, undefined, data);
  }
}

export async function createShopifyFulfillment(
  client: ShopifyGraphqlClient,
  fulfillment: Record<string, unknown>,
): Promise<{ id: string; status?: string }> {
  const data = await client.graphql<{
    fulfillmentCreate?: {
      fulfillment?: { id: string; status?: string } | null;
      userErrors?: Array<{ message?: string }>;
    };
  }>(FULFILLMENT_CREATE_MUTATION, { fulfillment });
  const errors = data.fulfillmentCreate?.userErrors ?? [];
  if (errors[0]?.message) {
    throw new ShopifyApiError(errors[0].message, undefined, data);
  }
  const created = data.fulfillmentCreate?.fulfillment;
  if (!created?.id) {
    throw new ShopifyApiError("Shopify did not return a fulfillment", undefined, data);
  }
  return created;
}
