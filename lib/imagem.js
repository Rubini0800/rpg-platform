"use strict";
// Validação de imagens pelos primeiros bytes ("magic numbers"), sem confiar no Content-Type enviado.
const EXTENSOES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

function detectarTipo(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    const cab = buf.subarray(0, 6).toString("latin1");
    if (cab === "GIF87a" || cab === "GIF89a") return "image/gif";
    if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
    return null;
}

// Converte "data:image/png;base64,...." em Buffer (usado só pela migração das campanhas antigas).
function dataUrlParaBuffer(dataUrl) {
    const m = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    return m ? Buffer.from(m[2], "base64") : null;
}

module.exports = { detectarTipo, dataUrlParaBuffer, EXTENSOES };
