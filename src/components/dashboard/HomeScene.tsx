"use client";

import Link from "next/link";
import { Home, MapPin } from "lucide-react";
import { useState } from "react";

export type HomeRoom = {
  id: string;
  name: string;
  itemCount: number;
  locations: { id: string; name: string; itemCount: number }[];
};

/** N1: real areas and storage locations, with a reversible room selection. */
export function HomeScene({ rooms }: { rooms: HomeRoom[] }) {
  const [selectedId, setSelectedId] = useState(rooms[0]?.id ?? "");
  const selected = rooms.find((room) => room.id === selectedId) ?? rooms[0];
  if (!selected) return null;

  function roomButton(room: HomeRoom) {
    return <button key={room.id} type="button" className="home-room" data-active={selected.id === room.id}
      aria-pressed={selected.id === room.id} aria-controls="home-room-contents" title={room.name}
      onClick={() => setSelectedId(room.id)}>
      <Home size={19} strokeWidth={1.6} aria-hidden="true" /><span>{room.name}</span><small>{room.itemCount} モノ</small>
    </button>;
  }

  return <section className="home-scene" aria-labelledby="home-scene-title">
    <div className="home-scene__drawing">
      <div className="home-scene__heading"><p>今日も、おかえりなさい。</p><h2 id="home-scene-title">わが家のなかみ</h2><span>お部屋を押して、のぞいてみよう。</span></div>
      <div className="home-illustration">
        <svg viewBox="0 0 600 340" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <g className="home-cloud"><path d="M437 55c-3-23 30-33 44-16 27-12 42 22 15 29h-59c-19-1-19-22 0-24" /></g>
          <path className="home-ground" d="M22 324h556" />
          <path className="home-roof" d="m91 139 209-121 209 121-12 17L300 42 103 156Z" />
          <path className="home-wall" d="M116 149 300 43l184 106v173H116Z" />
          <circle className="home-attic" cx="300" cy="102" r="25" />
          <path className="home-wood-line" d="M300 78v49m-24-25h48" />
          <g className="home-plant"><path d="M66 321v-63m0 28c-39-3-40-41-7-36m7 19c43-4 43-42 7-38"/><path d="M41 299h50l-8 24H49Z"/></g>
        </svg>
        <div className="home-rooms" data-rooms={Math.min(rooms.length, 4)}>{rooms.slice(0, 4).map(roomButton)}</div>
      </div>
      {rooms.length > 4 && <div className="home-extra-rooms">{rooms.slice(4).map(roomButton)}</div>}
    </div>
    <div id="home-room-contents" className="home-room-contents" aria-live="polite">
      <p className="ui-kicker">お部屋のなか</p><h3>{selected.name}</h3>
      <p className="home-room-summary">{selected.locations.length}か所に、{selected.itemCount}種類のモノを保管中</p>
      <div className="home-location-list">
        {selected.locations.map((location) => <Link key={location.id} href={`/app/locations/${location.id}`} className="home-location">
          <MapPin size={18} aria-hidden="true" /><span>{location.name}</span><small>{location.itemCount} モノ</small><span aria-hidden="true">↗</span>
        </Link>)}
        {!selected.locations.length && <p className="ui-muted">このお部屋の保管場所を登録しましょう。</p>}
      </div>
      <Link className="ui-button ui-button--secondary" href={selected.locations.length ? "/app/locations" : "/app/locations/new"}>{selected.locations.length ? "保管場所をすべて見る" : "保管場所を追加"}</Link>
    </div>
  </section>;
}
