"use strict";
// Escolhe onde as imagens ficam, pelo ambiente:
//   CLOUDINARY_URL definido (cloudinary://API_KEY:API_SECRET@CLOUD_NAME) -> Cloudinary (produção)
//   caso contrário -> disco local (apenas desenvolvimento)
// Para usar Supabase Storage, S3 ou R2, basta criar outra classe com os mesmos 2 métodos:
//   salvar({ buffer, mime, pasta }) -> { url, chave }      remover(chave)
const path = require("path");

function criarStorage(env = process.env) {
    let { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;
    if (env.CLOUDINARY_URL) {
        const u = new URL(env.CLOUDINARY_URL);
        if (u.protocol !== "cloudinary:") throw new Error("CLOUDINARY_URL deve começar com cloudinary://");
        cloudName = u.hostname; apiKey = decodeURIComponent(u.username); apiSecret = decodeURIComponent(u.password);
    }
    if (cloudName && apiKey && apiSecret) {
        const { StorageCloudinary } = require("./storage-cloudinary");
        return new StorageCloudinary({ cloudName, apiKey, apiSecret, pastaBase: env.CLOUDINARY_PASTA || "rpg-vtt", apiBase: env.CLOUDINARY_API_BASE || undefined });
    }
    const { StorageLocal } = require("./storage-local");
    return new StorageLocal(env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"));
}

module.exports = { criarStorage };
