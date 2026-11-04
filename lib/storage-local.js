"use strict";
// Armazenamento de imagens em disco local, SÓ PARA DESENVOLVIMENTO E TESTES.
// No Render gratuito o disco é efêmero: as imagens somem a cada reinício/deploy.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EXTENSOES } = require("./imagem");

class StorageLocal {
    constructor(diretorio) { this.nome = "local"; this.origemImagens = null; this.diretorio = diretorio; }

    async salvar({ buffer, mime, pasta }) {
        const sub = String(pasta).replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || "geral";
        const arquivo = crypto.randomBytes(12).toString("hex") + "." + EXTENSOES[mime];
        await fs.promises.mkdir(path.join(this.diretorio, sub), { recursive: true });
        await fs.promises.writeFile(path.join(this.diretorio, sub, arquivo), buffer);
        return { url: `/uploads/${sub}/${arquivo}`, chave: `${sub}/${arquivo}` };
    }

    async remover(chave) {
        if (!/^[A-Za-z0-9]{1,16}\/[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(chave)) return;   // nunca sai da pasta de uploads
        await fs.promises.unlink(path.join(this.diretorio, chave)).catch(erro => { if (erro.code !== "ENOENT") throw erro; });
    }
}

module.exports = { StorageLocal };
