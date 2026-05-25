// Fleet region definitions consumed by both the backend poller and the frontend map.
// Lat/lng values approximate the Azure datacenter or representative major city.
// API keys are injected from env vars (never committed).

export const REGIONS = [
    {
        code: 'de',
        label: 'Germany',
        subtitle: 'Frankfurt',
        countryIso: 'DE',
        url: 'https://wasup-de.azurewebsites.net',
        dcLat: 50.1109,
        dcLng: 8.6821,
        envKey: 'DE_API_KEY',
    },
    {
        code: 'fr',
        label: 'France',
        subtitle: 'Paris',
        countryIso: 'FR',
        url: 'https://wasup-fr.azurewebsites.net',
        dcLat: 48.8566,
        dcLng: 2.3522,
        envKey: 'FR_API_KEY',
    },
    {
        code: 'it',
        label: 'Italy',
        subtitle: 'Milan',
        countryIso: 'IT',
        url: 'https://wasup-it.azurewebsites.net',
        dcLat: 45.4642,
        dcLng: 9.1900,
        envKey: 'IT_API_KEY',
    },
    {
        code: 'fi',
        label: 'Finland',
        subtitle: 'Best-effort (DC: Sweden Central)',
        countryIso: 'FI',
        url: 'https://wasup-fi.azurewebsites.net',
        dcLat: 60.1699,
        dcLng: 24.9384,
        envKey: 'FI_API_KEY',
    },
    {
        code: 'se',
        label: 'Sweden',
        subtitle: 'Sweden Central (Gavle)',
        countryIso: 'SE',
        url: 'https://wasup-se.azurewebsites.net',
        dcLat: 59.3293,
        dcLng: 18.0686,
        envKey: 'SE_API_KEY',
    },
    {
        code: 'no',
        label: 'Norway',
        subtitle: 'Oslo',
        countryIso: 'NO',
        url: 'https://wasup-no.azurewebsites.net',
        dcLat: 59.9139,
        dcLng: 10.7522,
        envKey: 'NO_API_KEY',
    },
    {
        code: 'uk-south',
        label: 'UK South',
        subtitle: 'London',
        countryIso: 'GB',
        splitLabel: 'SOUTH',
        url: 'https://wasup-uk-south.azurewebsites.net',
        dcLat: 51.5074,
        dcLng: -0.1278,
        envKey: 'UK_SOUTH_API_KEY',
    },
    {
        code: 'uk-west',
        label: 'UK West',
        subtitle: 'Cardiff',
        countryIso: 'GB',
        splitLabel: 'WEST',
        url: 'https://wasup-uk-west.azurewebsites.net',
        dcLat: 51.4816,
        dcLng: -3.1791,
        envKey: 'UK_WEST_API_KEY',
    },
];

// Countries we want visually highlighted on the map even if not yet deployed.
// These show up as "expansion slots" - dimmed, not clickable for dashboard but shown on map.
export const EXPANSION_COUNTRIES = [
    { countryIso: 'NL', label: 'Netherlands', city: 'Amsterdam', lat: 52.3676, lng: 4.9041 },
    { countryIso: 'IE', label: 'Ireland', city: 'Dublin', lat: 53.3498, lng: -6.2603 },
    { countryIso: 'ES', label: 'Spain', city: 'Madrid', lat: 40.4168, lng: -3.7038 },
    { countryIso: 'BE', label: 'Belgium', city: 'Brussels', lat: 50.8503, lng: 4.3517 },
    { countryIso: 'CH', label: 'Switzerland', city: 'Zurich', lat: 47.3769, lng: 8.5417 },
    { countryIso: 'AT', label: 'Austria', city: 'Vienna', lat: 48.2082, lng: 16.3738 },
    { countryIso: 'DK', label: 'Denmark', city: 'Copenhagen', lat: 55.6761, lng: 12.5683 },
    { countryIso: 'PL', label: 'Poland', city: 'Warsaw', lat: 52.2297, lng: 21.0122 },
];

// All Western/Northern EU countries the map should render with visible borders.
// Includes active + expansion + a few neighbours for visual context.
export const MAP_COUNTRIES_ISO = [
    'GB', 'IE', 'FR', 'DE', 'IT', 'ES', 'PT',
    'NL', 'BE', 'LU', 'CH', 'AT', 'DK',
    'SE', 'NO', 'FI', 'IS',
    'PL', 'CZ',
];
