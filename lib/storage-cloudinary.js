"use strict";
// Armazenamento de imagens no Cloudinary, via API REST assinada (sem SDK: só fetch + crypto do Node 18+).
// Documentação: https://cloudinary.com/documentation/image_upload_api_reference
const crypto = require("crypto");

class StorageCloudinary {
    constructor({ cloudName, apiKey, apiSecret, pastaBase = "rpg-vtt", apiBase = "https://api.cloudinary.com" }) {
        Object.assign(this, { cloudName, apiKey, apiSecret, pastaBase, apiBase });
        this.nome = "cloudinary";
        this.origemImagens = "https://res.cloudinary.com";   // usado na Content-Security-Policy
    }

    // Assinatura: parâmetros (menos file, api_key, resource_type, cloud_name) ordenados e unidos em
    // "chave=valor&...", acrescidos do API secret, em SHA-1.
    assinar(params) {
        const texto = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== "").sort().map(k => `${k}=${params[k]}`).join("&");
        return crypto.createHash("sha1").update(texto + this.apiSecret).digest("hex");
    }

    async _chamar(acao, campos, arquivo) {
        const form = new FormData();
        for (const [k, v] of Object.entries(campos)) form.append(k, String(v));
        if (arquivo) form.append("file", new Blob([arquivo.buffer], { type: arquivo.mime }), "imagem");
        const resposta = await fetch(`${this.apiBase}/v1_1/${this.cloudName}/image/${acao}`, { method: "POST", body: form, signal: AbortSignal.timeout(30000) });
        const json = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(`Cloudinary ${acao} falhou (${resposta.status}): ${json?.error?.message || "sem detalhes"}`);
        return json;
    }

    async salvar({ buffer, mime, pasta }) {
        const assinados = { folder: `${this.pastaBase}/${pasta}`, timestamp: Math.floor(Date.now() / 1000) };
        const json = await this._chamar("upload", { ...assinados, api_key: this.apiKey, signature: this.assinar(assinados) }, { buffer, mime });
        if (!json.secure_url || !json.public_id) throw new Error("Cloudinary respondeu sem URL da imagem.");
        return { url: json.secure_url, chave: json.public_id };
    }

    async remover(chave) {
        const assinados = { invalidate: "true", public_id: chave, timestamp: Math.floor(Date.now() / 1000) };
        await this._chamar("destroy", { ...assinados, api_key: this.apiKey, signature: this.assinar(assinados) });
    }
}

module.exports = { StorageCloudinary };
