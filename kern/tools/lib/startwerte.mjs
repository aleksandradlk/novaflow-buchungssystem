// Converts a validated customer configuration into the start values that the
// backend command "nf-startwerte" imports (see kern/pb_hooks/nf/startwerte.js).

export function buildStartwerte(config) {
  const { kunde: K, angebote, termine: T, status, nachrichten: N, rechtliches, texte, branding } = config;

  const einstellungen = {
    buchbar_ab: T.zeitraum.buchbar_ab,
    buchbar_bis: T.zeitraum.buchbar_bis,
    folgetermin_ab: T.folgetermin?.ab ?? '',
    folgetermin_bis: T.folgetermin?.bis ?? '',
    folgetermin_typ: T.folgetermin?.termintyp ?? '',
    max_pro_woche: T.max_pro_woche ?? 0,
    ressourcen: T.ressourcen,
    termintypen: T.termintypen.map(({ code, name, dauer_minuten }) => ({ code, name, dauer_minuten })),
    status_liste: status.status.map((s) => ({
      code: s.code, name: s.name, mail: s.mail, start: !!s.start, abschluss: !!s.abschluss,
    })),
    mail_modus: N.modus,
    mail_adapter: N.adapter,
    test_empfaenger: N.test_empfaenger,
    absender: N.absender,
    ansprache: K.ansprache,
    hinweistexte: { du: texte.du, sie: texte.sie },
    betrieb: {
      kennung: K.kennung,
      name: K.name,
      firma: K.firma,
      domain: K.domain,
      zeitzone: K.zeitzone,
      logo: branding.logo,
    },
    module: K.module,
    formular: K.formular,
    rollen: K.rollen,
    loeschfristen: K.loeschfristen,
    nachrichten: {
      erinnerungen_tage_vorher: N.erinnerungen_tage_vorher,
      kampagne: N.kampagne,
      nachfass: N.nachfass,
    },
    rechtliches,
  };

  const angeboteListe = angebote.angebote.map((a) => ({
    code: a.code,
    name: a.name,
    beschreibung: a.beschreibung,
    preis_text: a.preis_text,
    termintyp: a.termintyp,
    ressource: a.ressource ?? '',
    folgetermin: !!a.folgetermin,
    zusatzoptionen: a.zusatzoptionen ?? [],
    aktiv: a.aktiv,
    sortierung: a.sortierung,
  }));

  // One record per weekday, as in the data model.
  const terminregeln = T.termintypen.flatMap((t) => t.regeln.flatMap((r) => r.wochentage.map((wochentag) => ({
    termintyp: t.code,
    wochentag,
    von: r.von,
    bis: r.bis,
    takt_minuten: r.takt_minuten,
    max_pro_slot: r.max_pro_slot,
    max_pro_tag: r.max_pro_tag ?? 0,
    gueltig_von: r.gueltig_von ?? '',
    gueltig_bis: r.gueltig_bis ?? '',
  }))));

  const sperrtage = T.sperrtage.map((s) => ({ datum: s.datum, grund: s.grund ?? '' }));

  return { einstellungen, angebote: angeboteListe, terminregeln, sperrtage };
}
