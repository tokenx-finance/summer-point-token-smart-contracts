#!/usr/bin/env node
"use strict";

/**
 * Fetch provider info for addresses from a CSV and save as JSON.
 *
 * Usage:
 *   node scripts/fetch-provider-info.js \
 *     --input blockscout-report_2025-08-25.csv \
 *     --rpc https://your-rpc-url \
 *     --contract 0xYourContractAddress \
 *     [--abi path/to/AllowlistRegistryProxy.json] \
 *     [--fn "getAccountProviderInfo(address)"] \
 *     [--extra-args '["0xProviderAddr",123]'] \
 *     [--from 0xYourCallerAddress] \
 *     [--output provider-info.json] \
 *     [--concurrency 5] \
 *     [--address-column address]
 *
 * Notes:
 * - If --abi is provided, the script will attempt to decode the return of
 *   getAccountProviderInfo(address). Otherwise, it will include the raw
 *   returnData hex for each address.
 * - Install deps: npm i ethers@^6
 */

const fs = require("fs");
const path = require("path");

// Lazy require to avoid crashing if ethers isn't installed until runtime
let ethers;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.split("=", 2);
      const key = k.replace(/^--/, "");
      if (v !== undefined) {
        args[key] = v;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function ensureHexAddress(addr) {
  return typeof addr === "string" && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// Minimal CSV parser that handles quoted fields and commas/newlines inside quotes
function parseCSV(content) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') { // Escaped quote
          field += '"';
          i++; // skip next
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\r") {
        // normalize CRLF -> treat CR as part of newline; skip
        continue;
      } else {
        field += ch;
      }
    }
  }
  // push last field/row if any
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function pickAddressColumns(headers, explicit) {
  if (!headers || headers.length === 0) return [];
  if (explicit) {
    const idx = headers.findIndex(h => h.trim().toLowerCase() === explicit.trim().toLowerCase());
    return idx >= 0 ? [idx] : [];
  }
  const priorities = [
    "address",
    "wallet",
    "account",
    "owner",
    "holder",
  ];
  const indices = [];
  for (const key of priorities) {
    const idx = headers.findIndex(h => h.toLowerCase() === key);
    if (idx >= 0) indices.push(idx);
  }
  // If exact matches not found, include any column containing 'address'
  if (indices.length === 0) {
    headers.forEach((h, i) => {
      if (/address/i.test(h)) indices.push(i);
    });
  }
  return Array.from(new Set(indices));
}

function extractAddressesFromCSV(rows, addressColumnName) {
  if (!rows || rows.length === 0) return [];
  const headers = rows[0].map(h => String(h || "").trim());
  const addrCols = pickAddressColumns(headers, addressColumnName);
  const set = new Set();

  if (addrCols.length > 0) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      for (const col of addrCols) {
        const v = (r[col] || "").trim();
        if (ensureHexAddress(v)) set.add(v);
        else {
          // fallback: scan the field for any 0x...40hex occurrences
          const matches = String(v).match(/0x[0-9a-fA-F]{40}/g);
          if (matches) matches.forEach(m => set.add(m));
        }
      }
    }
  } else {
    // Fallback: scan all cells for any 0x addresses
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      for (const cell of r) {
        const matches = String(cell || "").match(/0x[0-9a-fA-F]{40}/g);
        if (matches) matches.forEach(m => set.add(m));
      }
    }
  }
  return Array.from(set);
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function withConcurrency(limit, items, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      try {
        results[i] = await task(items[i], i);
      } catch (e) {
        results[i] = { error: e?.message || String(e) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

function toJSONSafe(value) {
  // Convert BigInt, Bytes, and Ethers values into JSON-safe primitives
  if (value == null) return value;
  const t = typeof value;
  if (t === "bigint") return value.toString();
  if (t === "string") return value;
  if (Array.isArray(value)) return value.map(toJSONSafe);
  if (t === "number" || t === "boolean") return value;
  // Uint8Array or BytesLike
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return "0x" + value.toString("hex");
  if (value instanceof Uint8Array) {
    try {
      if (!ethers) ethers = require("ethers");
      return ethers.hexlify(value);
    } catch { /* ignore */ }
  }
  // Objects: pick named keys if Result-like
  if (t === "object") {
    const out = {};
    for (const k of Object.keys(value)) {
      // skip numeric indices for ethers Result arrays
      if (!Number.isNaN(Number(k))) continue;
      out[k] = toJSONSafe(value[k]);
    }
    // If no named keys, try array-ish conversion
    if (Object.keys(out).length === 0 && Array.isArray(value)) {
      return value.map(toJSONSafe);
    }
    return out;
  }
  return String(value);
}

async function main() {
  const args = parseArgs(process.argv);
  const input = args.input || args.i || "blockscout-report_2025-08-25.csv";
  const output = args.output || args.o || "provider-info.json";
  const rpcUrl = args.rpc;
  const contractAddress = args.contract || args.addr;
  const abiPath = args.abi;
  const fnSig = args.fn || "getAccountProviderInfo(address)"; // can be name or full signature
  const fromAddress = args.from; // optional eth_call from
  let extraArgsRaw = args["extra-args"] || args.args;
  const addressColumn = args["address-column"] || args.column;
  const concurrency = Number(args.concurrency || 5);
  const delayMs = Number(args.delay || 0); // optional delay between calls per worker
  const start = args.start ? Number(args.start) : 0;
  const limit = args.limit ? Number(args.limit) : undefined;
  const noDecode = Boolean(args["no-decode"] || args.nodecode);

  if (!rpcUrl || !contractAddress) {
    console.error("Missing required --rpc and/or --contract arguments.");
    process.exit(1);
  }

  let abi = null;
  if (abiPath) {
    const fullAbiPath = path.resolve(abiPath);
    if (!fs.existsSync(fullAbiPath)) {
      console.warn(`ABI file not found at ${fullAbiPath}. Proceeding without ABI (raw encoding via --fn).`);
    }
    if (fs.existsSync(fullAbiPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(fullAbiPath, "utf8"));
        abi = Array.isArray(json) ? json : (Array.isArray(json.abi) ? json.abi : null);
        if (!abi) {
          console.warn("Provided ABI file did not contain an ABI array. Decoding will be skipped.");
        }
      } catch (e) {
        console.warn("Failed to parse ABI JSON. Decoding will be skipped.", e?.message || e);
        abi = null;
      }
    }
  }

  const csvPath = path.resolve(input);
  if (!fs.existsSync(csvPath)) {
    console.error(`Input CSV not found: ${csvPath}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(csvText);
  const allAddrs = extractAddressesFromCSV(rows, addressColumn);
  const sliced = allAddrs.slice(start, limit ? start + limit : undefined);

  if (sliced.length === 0) {
    console.error("No addresses found in CSV.");
    process.exit(1);
  }

  try {
    ethers = require("ethers");
  } catch (e) {
    console.error("This script requires ethers v6. Install with: npm i ethers@^6");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Build an Interface for encoding and optionally decoding
  let iface = null;
  let encodeFnKey = fnSig; // name or full signature
  try {
    if (abi) {
      iface = new ethers.Interface(abi);
      // If fnSig is a bare name and overloaded, require full signature
      try {
        const f = iface.getFunction(encodeFnKey);
        encodeFnKey = f.format();
      } catch (e) {
        // If not found by given key, but provided is a bare name, try to locate by name
        const matches = Object.values(iface.functions || {}).filter((f) => f.name === encodeFnKey);
        if (matches.length === 1) {
          encodeFnKey = matches[0].format();
        } else if (matches.length > 1) {
          console.warn(`Function name '${encodeFnKey}' is overloaded. Please pass --fn with full signature.`);
          process.exit(1);
        } else {
          console.warn(`Function '${encodeFnKey}' not found in ABI. Will try literal signature.`);
        }
      }
    } else {
      // Construct interface from the provided signature string
      // Accept forms like: "getAccountProviderInfo(address)" or full "function get...(address) view returns (...)"
      const frag = fnSig.trim().startsWith("function") ? fnSig.trim() : `function ${fnSig.trim()}`;
      iface = new ethers.Interface([frag]);
    }
  } catch (e) {
    console.warn("Failed to prepare interface from --fn/ABI:", e?.message || e);
    iface = null;
  }

  // Parse extra args (applied after the CSV address as first arg)
  let extraArgs = [];
  if (extraArgsRaw) {
    try {
      if (extraArgsRaw.trim().startsWith("[")) extraArgs = JSON.parse(extraArgsRaw);
      else extraArgs = extraArgsRaw.split(",").map(s => s.trim()).filter(Boolean);
    } catch (e) {
      console.warn("Failed to parse --extra-args; ignoring.", e?.message || e);
    }
  }

  console.log(`Addresses: ${sliced.length} (from ${allAddrs.length} found). Concurrency=${concurrency}`);

  const results = await withConcurrency(concurrency, sliced, async (addr, idx) => {
    try {
      if (!iface) throw new Error("No interface available to encode call. Provide --abi or --fn.");
      const argsArr = [addr, ...extraArgs];
      const data = iface.encodeFunctionData(encodeFnKey, argsArr);
      const callReq = { to: contractAddress, data };
      if (fromAddress) callReq.from = fromAddress;
      const returnData = await provider.call(callReq);

      let decoded = null;
      if (!noDecode) {
        try {
          // Attempt to decode if the interface knows the outputs
          const res = iface.decodeFunctionResult(encodeFnKey, returnData);
          decoded = toJSONSafe(res);
        } catch (_) { /* decoding optional */ }
      }

      if (delayMs > 0) await sleep(delayMs);
      return { address: addr, returnData, decoded };
    } catch (e) {
      return { address: addr, error: e?.message || String(e) };
    }
  });

  const outPath = path.resolve(output);
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Saved ${results.length} results to ${outPath}`);
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
