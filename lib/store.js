"use strict";
// Escolhe onde as campanhas são guardadas, pelo ambiente:
//   DATABASE_URL definido  -> PostgreSQL (use isto em produção no Render)
//   caso contrário         -> arquivo local (apenas desenvolvimento; perde dados no Render)
const path = require("path");

async function criarStore(env = process.env) {
    if (env.DATABASE_URL) {
        const { StorePostgres } = require("./store-postgres");   // só carrega 'pg' quando necessário
        const store = new StorePostgres(env.DATABASE_URL); await store.init(); return store;
    }
    const { StoreArquivo } = require("./store-arquivo");
    const store = new StoreArquivo(env.DADOS_ARQUIVO || path.join(__dirname, "..", "dados", "campanhas.json"));
    await store.init(); return store;
}

module.exports = { criarStore };
