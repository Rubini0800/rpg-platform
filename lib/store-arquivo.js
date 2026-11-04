"use strict";
// Persistência em arquivo JSON, SÓ PARA DESENVOLVIMENTO LOCAL E TESTES.
// No Render gratuito o disco é efêmero: este modo perde tudo a cada reinício.
const fs = require("fs");
const path = require("path");

class StoreArquivo {
    constructor(arquivo) { this.nome = "arquivo"; this.arquivo = arquivo; this.dados = {}; this.fila = Promise.resolve(); }

    async init() {
        await fs.promises.mkdir(path.dirname(this.arquivo), { recursive: true });
        try { this.dados = JSON.parse(await fs.promises.readFile(this.arquivo, "utf8")); }
        catch (erro) { if (erro.code !== "ENOENT") throw new Error(`Não consegui ler ${this.arquivo}: ${erro.message}`); }
    }

    // Gravação assíncrona e atômica (arquivo temporário + rename), uma por vez.
    _gravar() {
        this.fila = this.fila.then(async () => {
            const tmp = this.arquivo + ".tmp";
            await fs.promises.writeFile(tmp, JSON.stringify(this.dados), "utf8");
            await fs.promises.rename(tmp, this.arquivo);
        });
        return this.fila;
    }

    async criar(codigo, estado, mestreHash) {
        if (this.dados[codigo]) return false;
        this.dados[codigo] = { estado, mestreHash }; await this._gravar(); return true;
    }
    async carregar(codigo) {
        const r = this.dados[codigo];
        return r ? { estado: JSON.parse(JSON.stringify(r.estado)), mestreHash: r.mestreHash } : null;
    }
    async salvar(codigo, estado) {
        if (!this.dados[codigo]) return;
        this.dados[codigo].estado = JSON.parse(JSON.stringify(estado)); await this._gravar();
    }
    async fechar() { await this.fila; }
}

module.exports = { StoreArquivo };
