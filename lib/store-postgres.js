"use strict";
// Persistência em PostgreSQL (Neon, Supabase, Render Postgres pago, etc.).
// Uma linha por sala: o estado da mesa vai em JSONB; só o HASH da chave do Mestre é guardado.
const { Pool } = require("pg");

class StorePostgres {
    constructor(connectionString) {
        this.nome = "postgres";
        this.pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
        // Sem este handler, uma conexão ociosa derrubada pelo provedor (Neon suspende o banco quando
        // fica parado) emite 'error' sem tratamento e MATA o processo Node.
        this.pool.on("error", erro => console.error("[postgres] conexão ociosa encerrada:", erro.message));
    }

    async init() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS salas (
                codigo        TEXT PRIMARY KEY,
                estado        JSONB NOT NULL,
                mestre_hash   TEXT NOT NULL,
                criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            )`);
    }

    // Cria a sala só se o código estiver livre. Retorna false se já existir (a corrida é resolvida pelo banco).
    async criar(codigo, estado, mestreHash) {
        const r = await this.pool.query(
            "INSERT INTO salas (codigo, estado, mestre_hash) VALUES ($1, $2::jsonb, $3) ON CONFLICT (codigo) DO NOTHING",
            [codigo, JSON.stringify(estado), mestreHash]);
        return r.rowCount === 1;
    }

    async carregar(codigo) {
        const r = await this.pool.query("SELECT estado, mestre_hash FROM salas WHERE codigo = $1", [codigo]);
        if (!r.rows.length) return null;
        return { estado: r.rows[0].estado, mestreHash: r.rows[0].mestre_hash };
    }

    async salvar(codigo, estado) {
        await this.pool.query("UPDATE salas SET estado = $2::jsonb, atualizado_em = now() WHERE codigo = $1", [codigo, JSON.stringify(estado)]);
    }

    async fechar() { await this.pool.end(); }
}

module.exports = { StorePostgres };
