// Country data shared across app.
// WORLD_COUNTRIES: plain names for payment-profile country picker.
// COUNTRIES: structured code+regions for user profile / auth signup / admin.

export interface Country {
  code: string;
  name: string;
  regions: string[];
}

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'United States', regions: ['California', 'New York', 'Texas', 'Florida'] },
  { code: 'GB', name: 'United Kingdom', regions: ['England', 'Scotland', 'Wales'] },
  { code: 'CA', name: 'Canada', regions: ['Ontario', 'Quebec', 'British Columbia'] },
  { code: 'HR', name: 'Croatia', regions: ['Croatia'] },
  { code: 'RS', name: 'Serbia', regions: ['Serbia'] },
  { code: 'BA', name: 'Bosnia and Herzegovina', regions: ['Bosnia and Herzegovina'] },
  { code: 'SI', name: 'Slovenia', regions: ['Slovenia'] },
  { code: 'MK', name: 'North Macedonia', regions: ['North Macedonia'] },
  { code: 'IN', name: 'India', regions: ['India'] },
  { code: 'NL', name: 'Netherlands', regions: ['Netherlands'] },
];

export function countryName(code: string): string {
  return COUNTRIES.find(c => c.code === code)?.name || code;
}

export const WORLD_COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda",
  "Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain",
  "Bangladesh","Barbados","Belgium","Belize","Benin","Bhutan","Bolivia",
  "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso",
  "Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic",
  "Chad","Chile","China","Colombia","Comoros","Congo (Brazzaville)",
  "Congo (Kinshasa)","Costa Rica","Croatia","Cyprus","Czech Republic","Denmark",
  "Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador",
  "Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland",
  "France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada",
  "Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary",
  "Iceland","India","Indonesia","Iraq","Ireland","Israel","Italy","Jamaica",
  "Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Liberia","Liechtenstein","Lithuania",
  "Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta",
  "Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova",
  "Monaco","Mongolia","Montenegro","Morocco","Mozambique","Namibia","Nauru",
  "Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Macedonia",
  "Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea",
  "Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Rwanda",
  "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa",
  "San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia",
  "Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands",
  "South Africa","South Korea","Spain","Sri Lanka","Suriname","Sweden","Switzerland",
  "Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga",
  "Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda",
  "Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay",
  "Uzbekistan","Vanuatu","Vatican City","Vietnam","Zambia"
].sort();
