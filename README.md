# HeatCircuits

Planungssoftware für Fußbodenheizungen, inspiriert von LoopCAD und auf Europa ausgerichtet:
metrische Einheiten, °C, Heizlast in Anlehnung an **EN 12831-1 / DIN/TS 12831-1** und Auslegung nach **EN 1264-2/-3**.
Die App läuft vollständig im Browser, ohne Server und ohne Konto.

## Funktionen

| Bereich | Umfang |
| --- | --- |
| Grundriss | Bild laden (PNG, JPG, WebP, GIF, SVG), Maßstab über zwei Punkte mit bekanntem Abstand kalibrieren (1 m im Plan = 1 m im Bild), Bild verschieben, Deckkraft |
| Geschosse | beliebig viele Geschosse mit Höhenlage, Geschoss- und Raumhöhe; Umschalten rechts in der Geschossliste oder mit Bild ↑/↓; Wände des Nachbargeschosses scheinen durch |
| Zeichnen | Wände entlang der Achse (Außen-, Innen-, Wand zu unbeheizt; 36,5 / 30 / 24 / 17,5 / 11,5 cm), Längeneingabe per Tastatur, Ortho, Raster- und Eckenfang |
| Räume | Raumerkennung per Klick an der Wandinnenkante, Polygon oder Rechteck; Raumarten mit θ_int, n_min, Belag und Verlegeabstand vorbelegt |
| Heizkreise | automatische Verlegung als Schnecke (bifilar) oder Mäander, Aufteilung nach maximaler Kreislänge **und** maximalem Druckverlust |
| Leitungen | Anbindeleitung Raum → Verteiler automatisch orthogonal oder manuell geführt; Länge Verteiler → Wärmeerzeuger inkl. Steigleitung über Geschosse |
| Gebäude | Standort mit θ_e und θ_m,e (DE, AT, CH, weitere EU-Städte), Baustandard-Vorlagen für U-Werte (Altbau bis Passivhaus), Wärmebrückenzuschlag, WRG |
| Ergebnisse | Raumheizlast, Wärmestromdichte, Oberflächentemperatur, Spreizung, Massenstrom, Druckverlust, hydraulischer Abgleich, Verteiler, Materialliste |
| Export | Projektdatei (JSON inkl. Bilder), Plan als SVG, Tabellen als CSV (Semikolon, Dezimalkomma); Autosave im Browser |

## Bedienung

| Taste | Werkzeug |
| --- | --- |
| V | Auswählen / Bearbeiten (Eckpunkte ziehen, Mittelpunkte ziehen fügt Ecken ein) |
| H oder Leertaste | Ansicht verschieben |
| W | Wand zeichnen (Länge eintippen + Enter; Shift hebt Ortho auf; Esc beendet) |
| E | Raum per Klick erkennen |
| R / Q | Raum als Polygon / Rechteck |
| M | Heizkreisverteiler setzen |
| L | Anbindeleitung führen |
| G | Wärmeerzeuger setzen |
| K | Maßstab kalibrieren |
| B | Grundrissbild verschieben |
| D | Messen |
| F | Einpassen |
| ⌘/Strg + Z, ⇧⌘Z | Rückgängig / Wiederholen |
| ⌘/Strg + S | Projektdatei speichern |

Typischer Ablauf:

1. **Gebäude**: Standort, Baustandard und U-Werte festlegen.
2. **Grundriss laden** und mit **K** kalibrieren, z. B. über eine lange Maßkette.
3. Wände mit **W** nachzeichnen. Türöffnungen schließen, damit die Raumerkennung funktioniert.
4. Räume mit **E** erkennen, Raumart, Fensterfläche und Belag setzen.
5. Verteiler (**M**) und Wärmeerzeuger (**G**) platzieren, bei Bedarf Leitungen mit **L** führen.
6. **Auslegung**: Rohr, Estrich und Spreizung prüfen, gegebenenfalls Verlegeabstände optimieren.
7. Mit **+ Geschoss** weitere Geschosse anlegen; die Außenwände werden übernommen.

## Rechenverfahren

### Heizlast (vereinfacht nach EN 12831-1)

- Transmission: Φ_T = Σ A·(U + ΔU_WB)·b·(θ_int − θ_e)
  - Erdreich: f_g1 = 1,45, U, G_w = 1,0, Temperaturdifferenz (θ_int − θ_m,e)
  - Temperaturkorrekturfaktoren: Wand zu unbeheizt b = 0,5, Kellerdecke b = 0,5, Decke zum Dachraum b = 0,8
  - Innenwände zu kälteren Räumen desselben Geschosses mit U_Innenwand
- Lüftung: Φ_V = 0,34 Wh/(m³K) · n_min · V · (θ_int − θ_e) · (1 − η_WRG)
- Außenwandlängen werden aus den gezeichneten Außenwänden entlang der Raumkontur ermittelt und lassen sich je Raum überschreiben.
- **Nicht enthalten:** Wiederaufheizleistung, Grundwassereinfluss, Gewinne aus Nachbarräumen, vertikale Wärmeströme zwischen Geschossen mit unterschiedlicher Temperatur.

### Fußbodenheizung (EN 1264-2/-3, Nasssystem Typ A)

- Kennlinie q = B · a_B · a_T^m_T · a_ü^m_ü · a_D^m_D · Δθ_H mit B = 6,7 W/(m²K).
  - a_B und a_T sind exakt nach Norm.
  - a_ü und a_D sind tabellarisch genähert. Bei der Standardüberdeckung s_ü = 45 mm ist m_ü = 0, dann wirkt a_ü nicht.
- Grenzwärmestromdichte aus der Basiskennlinie q = 8,92·(θ_F,m − θ_i)^1,1 mit θ_F,max = 29 °C (Aufenthaltszone) bzw. 33 °C (Bad).
- Vorlauftemperatur: aus dem Raum mit der höchsten Δθ_H ohne Bäder, bei σ = 5 K, exakt über den logarithmischen Mittelwert. Alternativ fest vorgebbar.
- Spreizung der übrigen Räume: numerisch aus Δθ_H(σ) = σ / ln((θ_V − θ_i)/(θ_V − σ − θ_i)). Reicht der Vorlauf nicht aus, gilt σ = 3 K und die Restleistung wird als Zusatzheizfläche ausgewiesen.
- Massenstrom nach EN 1264-3 inkl. Wärmeabgabe nach unten (R_o, R_u).
- Rohrlänge: L = A/VA + 2·l_Anbindung. Die Kreisaufteilung erfolgt nach L_max und Δp_max.
- Druckverlust nach Darcy-Weisbach (laminar 64/Re, turbulent Blasius); Wasser bei ca. 35 °C. Einzelwiderstände von Verteiler und Ventilen sind nicht enthalten.

Die Klimadaten sind Richtwerte zur Vorbelegung. Verbindlich sind die nationalen Anhänge (DIN/TS 12831-1 nach PLZ, ÖNORM H 7500-1, SIA 384/2).
Die Ergebnisse ersetzen nicht die geprüften Systemkennlinien des Rohr- bzw. Systemherstellers.

## Entwicklung

```bash
npm install          # .npmrc setzt legacy-peer-deps
npm run dev          # Entwicklungsserver
npm test             # Vitest (Geometrie, EN 1264, Heizlast, Hydraulik)
npm run build        # statische Seite in dist/
npm run build:single # eine eigenständige HTML-Datei in dist-single/
```

Struktur:

```
src/
  model/      Datenmodell, Stammdaten (Klima, Raumarten, Beläge, Rohre), Store mit Undo/Redo, Beispielprojekt
  geometry/   Polygonoperationen, Raumerkennung (Rasterflutung + Konturverfolgung), Verlegemuster
  calc/       Heizlast, EN-1264-Kennlinie, Hydraulik, Projektauslegung
  ui/         SVG-Editor, Darstellung, Seitenleiste, Dialoge
  io/         Autosave (IndexedDB), Projektdatei, SVG-Export
```

`dist/` ist eine rein statische Seite. Sie lässt sich z. B. auf Amazon S3 mit CloudFront (Origin Access Control) hosten oder mit Tauri als macOS-App verpacken.
