import { requestUrl } from "obsidian";
import { createHmac, randomBytes } from "crypto";

export interface XAuthConfig {
	apiKey: string;
	apiSecret: string;
	accessToken: string;
	accessTokenSecret: string;
}

function percentEncode(input: string): string {
	return encodeURIComponent(input)
		.replace(/[!'()*]/g, (c) =>
			`%${c.charCodeAt(0).toString(16).toUpperCase()}`,
		);
}

function buildOAuthHeader(
	method: string,
	url: string,
	auth: XAuthConfig,
	extraParams: Record<string, string> = {},
): string {
	const oauthParams: Record<string, string> = {
		oauth_consumer_key: auth.apiKey,
		oauth_nonce: randomBytes(16).toString("hex"),
		oauth_signature_method: "HMAC-SHA1",
		oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
		oauth_token: auth.accessToken,
		oauth_version: "1.0",
	};

	const allParams = { ...oauthParams, ...extraParams };
	const sortedParamString = Object.keys(allParams)
		.sort()
		.map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
		.join("&");

	const baseString = [
		method.toUpperCase(),
		percentEncode(url),
		percentEncode(sortedParamString),
	].join("&");

	const signingKey = `${percentEncode(auth.apiSecret)}&${percentEncode(
		auth.accessTokenSecret,
	)}`;
	const signature = createHmac("sha1", signingKey)
		.update(baseString)
		.digest("base64");

	oauthParams.oauth_signature = signature;

	return `OAuth ${Object.keys(oauthParams)
		.sort()
		.map(
			(k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`,
		)
		.join(", ")}`;
}

export async function xUploadImage(
	auth: XAuthConfig,
	data: Blob,
	filename: string,
): Promise<{ media_id_string?: string; error?: string }> {
	const url = "https://upload.twitter.com/1.1/media/upload.json";
	const boundary = `----zepress-${randomBytes(8).toString("hex")}`;
	const pre = `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
	const post = `\r\n--${boundary}--`;
	const body = await new Blob([
		new TextEncoder().encode(pre),
		await data.arrayBuffer(),
		new TextEncoder().encode(post),
	]).arrayBuffer();

	const authHeader = buildOAuthHeader("POST", url, auth);
	const res = await requestUrl({
		url,
		method: "POST",
		throw: false,
		headers: {
			Authorization: authHeader,
		},
		contentType: `multipart/form-data; boundary=${boundary}`,
		body,
	});
	const json = await res.json;
	if (json?.media_id_string) return { media_id_string: json.media_id_string };
	return { error: json?.error || json?.errors?.[0]?.message || "upload_failed" };
}

export async function xCreateTweet(
	auth: XAuthConfig,
	text: string,
	options?: { mediaIds?: string[]; replyToId?: string },
): Promise<{ id?: string; error?: string }> {
	const url = "https://api.twitter.com/2/tweets";
	const body: any = { text };
	if (options?.mediaIds?.length) {
		body.media = { media_ids: options.mediaIds };
	}
	if (options?.replyToId) {
		body.reply = { in_reply_to_tweet_id: options.replyToId };
	}

	const authHeader = buildOAuthHeader("POST", url, auth);
	const res = await requestUrl({
		url,
		method: "POST",
		throw: false,
		headers: {
			Authorization: authHeader,
		},
		contentType: "application/json",
		body: JSON.stringify(body),
	});
	const json = await res.json;
	if (json?.data?.id) return { id: json.data.id };
	return {
		error:
			json?.detail ||
			json?.title ||
			json?.errors?.[0]?.message ||
			"create_tweet_failed",
	};
}

export async function xVerifyCredentials(
	auth: XAuthConfig,
): Promise<{ ok: boolean; username?: string; error?: string }> {
	const url = "https://api.twitter.com/1.1/account/verify_credentials.json";
	const authHeader = buildOAuthHeader("GET", url, auth, {
		include_email: "false",
	});
	const res = await requestUrl({
		url: `${url}?include_email=false`,
		method: "GET",
		throw: false,
		headers: {
			Authorization: authHeader,
		},
	});
	const json = await res.json;
	if (json?.id_str || json?.screen_name) {
		return { ok: true, username: json.screen_name || json.name };
	}
	return {
		ok: false,
		error:
			json?.errors?.[0]?.message ||
			json?.detail ||
			json?.title ||
			"verify_credentials_failed",
	};
}
