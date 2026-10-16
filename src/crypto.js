// AES-GCM encryption for credentials kept in the ADMIN_CONFIG KV namespace.
// The key is derived from the CONFIG_ENCRYPTION_KEY Worker secret (any string of 32+ characters).
//
// Stored format: "v1.<base64url iv>.<base64url ciphertext>"

const MIN_KEY_LENGTH = 32;

function toB64(bytes) {
	let bin = "";
	for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(value) {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function encryptionReady(env) {
	return typeof env.CONFIG_ENCRYPTION_KEY === "string" && env.CONFIG_ENCRYPTION_KEY.length >= MIN_KEY_LENGTH;
}

async function importKey(env) {
	if (!encryptionReady(env)) throw new Error(`CONFIG_ENCRYPTION_KEY must be set to a secret of at least ${MIN_KEY_LENGTH} characters`);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.CONFIG_ENCRYPTION_KEY));
	return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptJson(env, value) {
	const key = await importKey(env);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = new TextEncoder().encode(JSON.stringify(value));
	const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
	return `v1.${toB64(iv)}.${toB64(ciphertext)}`;
}

export async function decryptJson(env, stored) {
	const [version, iv, ciphertext] = String(stored).split(".");
	if (version !== "v1" || !iv || !ciphertext) throw new Error("Unrecognised credential format");
	const key = await importKey(env);
	try {
		const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ciphertext));
		return JSON.parse(new TextDecoder().decode(plain));
	} catch {
		throw new Error("Could not decrypt saved credentials (was CONFIG_ENCRYPTION_KEY changed?)");
	}
}
