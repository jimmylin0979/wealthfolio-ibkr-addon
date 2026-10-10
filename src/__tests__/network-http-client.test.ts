import { describe, it, expect, vi } from "vitest";
import { createNetworkHttpClient } from "../lib/network-http-client";

function makeNetwork(response: {
  status: number;
  headers?: Record<string, string>;
  body: string;
}) {
  return { request: vi.fn().mockResolvedValue({ ...response, headers: response.headers ?? {} }) };
}

describe("createNetworkHttpClient", () => {
  it("maps a fetch call to network.request with url, GET default, headers, and 60s timeout", async () => {
    const network = makeNetwork({ status: 200, body: "<FlexQueryResponse/>" });
    const client = createNetworkHttpClient(network);

    const result = await client.fetch("https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest");

    expect(network.request).toHaveBeenCalledWith({
      url: "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest",
      method: "GET",
      headers: undefined,
      body: undefined,
      timeoutSecs: 60,
    });
    expect(result).toEqual({
      status: 200,
      status_text: "",
      headers: {},
      body: "<FlexQueryResponse/>",
      ok: true,
    });
  });

  it("passes through method, headers, body and converts timeout_ms to timeoutSecs", async () => {
    const network = makeNetwork({ status: 201, body: "ok" });
    const client = createNetworkHttpClient(network);

    await client.fetch("https://example.com/x", {
      method: "POST",
      headers: { "User-Agent": "Wealthfolio/1.0" },
      body: "<xml/>",
      timeout_ms: 1500,
    });

    expect(network.request).toHaveBeenCalledWith({
      url: "https://example.com/x",
      method: "POST",
      headers: { "User-Agent": "Wealthfolio/1.0" },
      body: "<xml/>",
      timeoutSecs: 2,
    });
  });

  it("caps timeoutSecs at the host maximum of 120", async () => {
    const network = makeNetwork({ status: 200, body: "" });
    const client = createNetworkHttpClient(network);

    await client.fetch("https://example.com/x", { timeout_ms: 600_000 });

    expect(network.request).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutSecs: 120 })
    );
  });

  it("derives ok from status and passes headers/body through", async () => {
    const network = makeNetwork({
      status: 500,
      headers: { "content-type": "text/xml" },
      body: "<Status>Error</Status>",
    });
    const client = createNetworkHttpClient(network);

    const result = await client.fetch("https://example.com/x");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.headers).toEqual({ "content-type": "text/xml" });
    expect(result.body).toBe("<Status>Error</Status>");
  });

  it("propagates network.request rejections to the caller", async () => {
    const network = {
      request: vi.fn().mockRejectedValue(new Error("host not allowed")),
    };
    const client = createNetworkHttpClient(network);

    await expect(client.fetch("https://evil.example.com/x")).rejects.toThrow(
      "host not allowed"
    );
  });
});
