import { html, Mark, PageHead } from './lib.js';

// "O názvu": where the name comes from, told with credit and without borrowed Indigenous designs.
export function AboutPage() {
  return html`<div class="page about">
    <${PageHead} title="O názvu" sub="proč se aplikace jmenuje Raven" />
    <div class="about-hero">
      <${Mark} title="Raven" />
      <div>
        <p><b>Raven (Havran)</b> je velký šibal, proměňovač a kulturní hrdina v příbězích původních národů severozápadního pobřeží Severní Ameriky – mimo jiné Haidů (<i>Yáahl</i>) a Tlingitů (<i>Yéil</i>). Příbuzné postavy Havrana znají i Inuité a národy Dene.</p>
        <p>Nejznámější příběh vypráví, jak Havran ukradl světlo, které mocný náčelník držel zamčené v krabicích, a pustil do světa slunce, měsíc a hvězdy.</p>
      </div>
    </div>

    <h3>Několik příběhů</h3>
    <div class="about-stories">
      <div class="about-story"><b>Havran krade světlo</b><p>Promění se v drobné smítko, narodí se jako vnuk náčelníka, vyškemrá si krabice se světlem a s ním uletí kouřovým otvorem.</p></div>
      <div class="about-story"><b>Havran a první lidé</b><p>Na pláži najde lasturu plnou ustrašených bytostí. Ze zvědavosti je vyláká ven – a z nich jsou první lidé.</p></div>
      <div class="about-story"><b>Sladká voda a lososi</b><p>Lstí získá vodu a lososy a při útěku je rozlije po zemi. Tak vznikly řeky, jezera a tahy lososů.</p></div>
      <div class="about-story"><b>Proč je Havran černý</b><p>Býval bílý. Když prolétal kouřovým otvorem s ukradeným světlem, začernal ho kouř – a černý už zůstal.</p></div>
    </div>

    <h3>Co to znamená pro naši školu</h3>
    <p>Raven přináší do školního týdne světlo: ukazuje, kdo co učí, kde a kdy. Stojí za zvědavostí, se kterou si žáci vybírají hodiny, a za proměnou, kterou sledují osobní cíle. A jako správný šibal se nebere příliš vážně.</p>
    <p>Odtud i podoba aplikace: tmavý, klidný prostor, ve kterém je rozsvíceno to důležité – dnešek, nejbližší hodina, tvůj cíl. Značka ukazuje světlo vycházející z otevřené krabice.</p>

    <h3>S respektem</h3>
    <div class="about-note">
      <p>Příběhy o Havranovi patří konkrétním národům a jejich výtvarná tradice (tzv. formline) je živé umění; některé návrhy Havrana jsou majetkem klanů. Raven proto nepoužívá žádné původní indiánské motivy ani jejich napodobeniny – vizuální styl i značka jsou vlastní.</p>
      <p>Více o Havranovi a umění severozápadního pobřeží: <a href="https://moa.ubc.ca/" target="_blank" rel="noopener">Museum of Anthropology (UBC)</a> s plastikou Billa Reida <i>The Raven and the First Men</i>, a <a href="https://sealaskaheritage.org/" target="_blank" rel="noopener">Sealaska Heritage Institute</a>.</p>
    </div>
  </div>`;
}
