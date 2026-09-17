import { COUNTRIES } from '../lib/countries';

interface CountrySelectProps {
  value: string;
  onChange: (code: string) => void;
  className?: string;
}

export default function CountrySelect({ value, onChange, className }: CountrySelectProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={className}
    >
      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
  );
}
