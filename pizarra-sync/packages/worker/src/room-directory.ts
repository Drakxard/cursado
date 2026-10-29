/** Persistent public names point to stable board IDs; renaming never moves board data. */
export class RoomDirectory {
  constructor(private readonly state: DurableObjectState) {
    state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS aliases (slug TEXT PRIMARY KEY, room_id TEXT NOT NULL)",
    );
  }

  async fetch(request: Request): Promise<Response> {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    };
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/rooms/resolve") {
      const name = url.searchParams.get("name") || "";
      if (!/^[a-z0-9-]{1,64}$/.test(name)) return json({ error: "Nombre de sala inválido" }, 400);
      const direct = url.searchParams.get("direct") === "1";
      const match = this.state.storage.sql
        .exec<{ room_id: string }>("SELECT room_id FROM aliases WHERE slug = ?", name)
        .toArray()[0];
      const roomId = direct ? name : match?.room_id || name;
      // Reserve a previously unseen path so a future rename cannot steal its board.
      if (!match)
        this.state.storage.sql.exec(
          "INSERT INTO aliases (slug, room_id) VALUES (?, ?)",
          name,
          roomId,
        );
      return json({ roomId });
    }
    if (request.method !== "POST" || url.pathname !== "/rooms/rename") {
      return json({ error: "Not found" }, 404);
    }
    let data: { roomId?: unknown; title?: unknown };
    try {
      data = await request.json();
    } catch {
      return json({ error: "Solicitud inválida" }, 400);
    }
    const { roomId } = data;
    const title =
      typeof data.title === "string" ? data.title.trim().replace(/\s+/g, " ").slice(0, 80) : "";
    if (typeof roomId !== "string" || !/^[a-z0-9-]{1,64}$/.test(roomId) || !title) {
      return json({ error: "Nombre de sala inválido" }, 400);
    }
    const slug =
      title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64) || "sala";
    return this.state.storage.transactionSync(() => {
      const owner = this.state.storage.sql
        .exec<{ room_id: string }>("SELECT room_id FROM aliases WHERE slug = ?", slug)
        .toArray()[0];
      if (owner && owner.room_id !== roomId)
        return json({ error: "Ese nombre ya está en uso. Elegí otro para la sala." }, 409);
      this.state.storage.sql.exec(
        "INSERT OR IGNORE INTO aliases (slug, room_id) VALUES (?, ?)",
        roomId,
        roomId,
      );
      this.state.storage.sql.exec(
        "INSERT OR IGNORE INTO aliases (slug, room_id) VALUES (?, ?)",
        slug,
        roomId,
      );
      return json({ roomId, title, slug });
    });
  }
}
