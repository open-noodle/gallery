// The English names reverse geocoding writes to `asset_exif.country`: the Country column of GeoNames
// `countryInfo.txt`, keyed to its ISO 3166-1 alpha-2 code. The server stores the name, never the code.
const COUNTRY_CODES_BY_NAME: Readonly<Record<string, string>> = {
  Afghanistan: 'AF',
  'Aland Islands': 'AX',
  Albania: 'AL',
  Algeria: 'DZ',
  'American Samoa': 'AS',
  Andorra: 'AD',
  Angola: 'AO',
  Anguilla: 'AI',
  Antarctica: 'AQ',
  'Antigua and Barbuda': 'AG',
  Argentina: 'AR',
  Armenia: 'AM',
  Aruba: 'AW',
  Australia: 'AU',
  Austria: 'AT',
  Azerbaijan: 'AZ',
  Bahamas: 'BS',
  Bahrain: 'BH',
  Bangladesh: 'BD',
  Barbados: 'BB',
  Belarus: 'BY',
  Belgium: 'BE',
  Belize: 'BZ',
  Benin: 'BJ',
  Bermuda: 'BM',
  Bhutan: 'BT',
  Bolivia: 'BO',
  'Bonaire, Saint Eustatius and Saba': 'BQ',
  'Bosnia and Herzegovina': 'BA',
  Botswana: 'BW',
  'Bouvet Island': 'BV',
  Brazil: 'BR',
  'British Indian Ocean Territory': 'IO',
  'British Virgin Islands': 'VG',
  Brunei: 'BN',
  Bulgaria: 'BG',
  'Burkina Faso': 'BF',
  Burundi: 'BI',
  'Cabo Verde': 'CV',
  Cambodia: 'KH',
  Cameroon: 'CM',
  Canada: 'CA',
  'Cayman Islands': 'KY',
  'Central African Republic': 'CF',
  Chad: 'TD',
  Chile: 'CL',
  China: 'CN',
  'Christmas Island': 'CX',
  'Cocos Islands': 'CC',
  Colombia: 'CO',
  Comoros: 'KM',
  'Cook Islands': 'CK',
  'Costa Rica': 'CR',
  Croatia: 'HR',
  Cuba: 'CU',
  Curacao: 'CW',
  Cyprus: 'CY',
  Czechia: 'CZ',
  'Democratic Republic of the Congo': 'CD',
  Denmark: 'DK',
  Djibouti: 'DJ',
  Dominica: 'DM',
  'Dominican Republic': 'DO',
  Ecuador: 'EC',
  Egypt: 'EG',
  'El Salvador': 'SV',
  'Equatorial Guinea': 'GQ',
  Eritrea: 'ER',
  Estonia: 'EE',
  Eswatini: 'SZ',
  Ethiopia: 'ET',
  'Falkland Islands': 'FK',
  'Faroe Islands': 'FO',
  Fiji: 'FJ',
  Finland: 'FI',
  France: 'FR',
  'French Guiana': 'GF',
  'French Polynesia': 'PF',
  'French Southern Territories': 'TF',
  Gabon: 'GA',
  Gambia: 'GM',
  Georgia: 'GE',
  Germany: 'DE',
  Ghana: 'GH',
  Gibraltar: 'GI',
  Greece: 'GR',
  Greenland: 'GL',
  Grenada: 'GD',
  Guadeloupe: 'GP',
  Guam: 'GU',
  Guatemala: 'GT',
  Guernsey: 'GG',
  Guinea: 'GN',
  'Guinea-Bissau': 'GW',
  Guyana: 'GY',
  Haiti: 'HT',
  'Heard Island and McDonald Islands': 'HM',
  Honduras: 'HN',
  'Hong Kong': 'HK',
  Hungary: 'HU',
  Iceland: 'IS',
  India: 'IN',
  Indonesia: 'ID',
  Iran: 'IR',
  Iraq: 'IQ',
  Ireland: 'IE',
  'Isle of Man': 'IM',
  Israel: 'IL',
  Italy: 'IT',
  'Ivory Coast': 'CI',
  Jamaica: 'JM',
  Japan: 'JP',
  Jersey: 'JE',
  Jordan: 'JO',
  Kazakhstan: 'KZ',
  Kenya: 'KE',
  Kiribati: 'KI',
  Kosovo: 'XK',
  Kuwait: 'KW',
  Kyrgyzstan: 'KG',
  Laos: 'LA',
  Latvia: 'LV',
  Lebanon: 'LB',
  Lesotho: 'LS',
  Liberia: 'LR',
  Libya: 'LY',
  Liechtenstein: 'LI',
  Lithuania: 'LT',
  Luxembourg: 'LU',
  Macao: 'MO',
  Madagascar: 'MG',
  Malawi: 'MW',
  Malaysia: 'MY',
  Maldives: 'MV',
  Mali: 'ML',
  Malta: 'MT',
  'Marshall Islands': 'MH',
  Martinique: 'MQ',
  Mauritania: 'MR',
  Mauritius: 'MU',
  Mayotte: 'YT',
  Mexico: 'MX',
  Micronesia: 'FM',
  Moldova: 'MD',
  Monaco: 'MC',
  Mongolia: 'MN',
  Montenegro: 'ME',
  Montserrat: 'MS',
  Morocco: 'MA',
  Mozambique: 'MZ',
  Myanmar: 'MM',
  Namibia: 'NA',
  Nauru: 'NR',
  Nepal: 'NP',
  'Netherlands Antilles': 'AN',
  'New Caledonia': 'NC',
  'New Zealand': 'NZ',
  Nicaragua: 'NI',
  Niger: 'NE',
  Nigeria: 'NG',
  Niue: 'NU',
  'Norfolk Island': 'NF',
  'North Korea': 'KP',
  'North Macedonia': 'MK',
  'Northern Mariana Islands': 'MP',
  Norway: 'NO',
  Oman: 'OM',
  Pakistan: 'PK',
  Palau: 'PW',
  'Palestinian Territory': 'PS',
  Panama: 'PA',
  'Papua New Guinea': 'PG',
  Paraguay: 'PY',
  Peru: 'PE',
  Philippines: 'PH',
  Pitcairn: 'PN',
  Poland: 'PL',
  Portugal: 'PT',
  'Puerto Rico': 'PR',
  Qatar: 'QA',
  'Republic of the Congo': 'CG',
  Reunion: 'RE',
  Romania: 'RO',
  Russia: 'RU',
  Rwanda: 'RW',
  'Saint Barthelemy': 'BL',
  'Saint Helena': 'SH',
  'Saint Kitts and Nevis': 'KN',
  'Saint Lucia': 'LC',
  'Saint Martin': 'MF',
  'Saint Pierre and Miquelon': 'PM',
  'Saint Vincent and the Grenadines': 'VC',
  Samoa: 'WS',
  'San Marino': 'SM',
  'Sao Tome and Principe': 'ST',
  'Saudi Arabia': 'SA',
  Senegal: 'SN',
  'Serbia and Montenegro': 'CS',
  Serbia: 'RS',
  Seychelles: 'SC',
  'Sierra Leone': 'SL',
  Singapore: 'SG',
  'Sint Maarten': 'SX',
  Slovakia: 'SK',
  Slovenia: 'SI',
  'Solomon Islands': 'SB',
  Somalia: 'SO',
  'South Africa': 'ZA',
  'South Georgia and the South Sandwich Islands': 'GS',
  'South Korea': 'KR',
  'South Sudan': 'SS',
  Spain: 'ES',
  'Sri Lanka': 'LK',
  Sudan: 'SD',
  Suriname: 'SR',
  'Svalbard and Jan Mayen': 'SJ',
  Sweden: 'SE',
  Switzerland: 'CH',
  Syria: 'SY',
  Taiwan: 'TW',
  Tajikistan: 'TJ',
  Tanzania: 'TZ',
  Thailand: 'TH',
  'The Netherlands': 'NL',
  'Timor Leste': 'TL',
  Togo: 'TG',
  Tokelau: 'TK',
  Tonga: 'TO',
  'Trinidad and Tobago': 'TT',
  Tunisia: 'TN',
  Turkey: 'TR',
  Turkmenistan: 'TM',
  'Turks and Caicos Islands': 'TC',
  Tuvalu: 'TV',
  'U.S. Virgin Islands': 'VI',
  Uganda: 'UG',
  Ukraine: 'UA',
  'United Arab Emirates': 'AE',
  'United Kingdom': 'GB',
  'United States Minor Outlying Islands': 'UM',
  'United States': 'US',
  Uruguay: 'UY',
  Uzbekistan: 'UZ',
  Vanuatu: 'VU',
  Vatican: 'VA',
  Venezuela: 'VE',
  Vietnam: 'VN',
  'Wallis and Futuna': 'WF',
  'Western Sahara': 'EH',
  Yemen: 'YE',
  Zambia: 'ZM',
  Zimbabwe: 'ZW',
};

const displayNamesByLocale = new Map<string, Intl.DisplayNames | undefined>();

const getDisplayNames = (locale: string) => {
  if (!displayNamesByLocale.has(locale)) {
    let displayNames: Intl.DisplayNames | undefined;
    try {
      displayNames = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
    } catch {
      // not a locale Intl can parse
    }
    displayNamesByLocale.set(locale, displayNames);
  }
  return displayNamesByLocale.get(locale);
};

/** Display only: filters, URLs and API calls keep the stored English name. */
export const localizeCountry = (name: string, locale?: string | null): string => {
  // The stored names are GeoNames English, and CLDR English words some of them differently ("The Netherlands").
  if (!locale || locale === 'dev' || locale.split(/[_-]/, 1)[0] === 'en') {
    return name;
  }

  const code = COUNTRY_CODES_BY_NAME[name.trim()];
  if (!code) {
    return name;
  }

  try {
    return getDisplayNames(locale)?.of(code) ?? name;
  } catch {
    return name;
  }
};

/** True when `query` (already lowercased) is in the stored name or in its localized form. */
export const countryMatchesQuery = (name: string, locale: string | null | undefined, query: string): boolean =>
  name.toLowerCase().includes(query) || localizeCountry(name, locale).toLowerCase().includes(query);

const collatorsByLocale = new Map<string, Intl.Collator>();

const getCollator = (locale: string | null | undefined) => {
  const key = locale ?? '';
  let collator = collatorsByLocale.get(key);
  if (!collator) {
    try {
      collator = new Intl.Collator(locale && locale !== 'dev' ? [locale] : undefined, { sensitivity: 'base' });
    } catch {
      collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    }
    collatorsByLocale.set(key, collator);
  }
  return collator;
};

/** The stored names, ordered by the name the UI shows for them (the server orders by the stored English name). */
export const sortCountries = (names: readonly string[], locale?: string | null): string[] => {
  const collator = getCollator(locale);
  return names
    .map((name) => ({ name, label: localizeCountry(name, locale) }))
    .sort((a, b) => collator.compare(a.label, b.label))
    .map(({ name }) => name);
};
