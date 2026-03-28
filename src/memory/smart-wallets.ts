// src/memory/smart-wallets.ts
import { getDb } from "./sqlite";

export interface SmartWallet {
    id?: number;
    address: string;
    label: string;
    addedAt?: string;
}

export function addSmartWallet(address: string, label: string = ""): void {
    const db = getDb();
    db.prepare(`
        INSERT INTO smart_wallets (address, label)
        VALUES ($address, $label)
        ON CONFLICT(address) DO UPDATE SET label = $label
    `).run({ $address: address, $label: label });
}

export function removeSmartWallet(address: string): boolean {
    const db = getDb();
    const result = db.prepare("DELETE FROM smart_wallets WHERE address = $address").run({ $address: address });
    return result.changes > 0;
}

export function listSmartWallets(): SmartWallet[] {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM smart_wallets ORDER BY added_at DESC").all() as any[];
    return rows.map(row => ({
        id: row.id,
        address: row.address,
        label: row.label || "",
        addedAt: row.added_at,
    }));
}

export function isSmartWallet(address: string): boolean {
    const db = getDb();
    const row = db.prepare("SELECT 1 FROM smart_wallets WHERE address = $address").get({ $address: address });
    return !!row;
}
