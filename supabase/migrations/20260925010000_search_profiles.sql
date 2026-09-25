-- search_profiles — accent-insensitive, typo-tolerant people search for chat.
--
-- 2026-09-23 the Contracts Admin asked chat to end-date "Mirza Hukic". The
-- profile is "Mirza Hukić"; chat-parse matched names with plain ILIKE, which
-- is accent-sensitive, so it answered "No user found" and the request died.
-- Most contractors have Balkan names (ć č š ž đ) typed on US keyboards.
--
-- Match tiers (best first), all on unaccented lower-case text:
--   exact    name = query, or email local part (dots → spaces) = query
--   contains name contains the query
--   tokens   every word of the query appears in the name, any order
--   similar  trigram similarity ≥ 0.3 (typos, missing letters)
-- Returns project name so the bot can say "Mirza Hukić (Genworth/CareScout)".

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.search_profiles(
  q text,
  role_filter text DEFAULT NULL,
  max_results int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  start_date date,
  end_date date,
  role text,
  project_name text,
  match_kind text,
  score real
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH n AS (
    SELECT lower(public.unaccent(btrim(q))) AS nq
  ),
  c AS (
    SELECT p.id, p.name, p.email, p.start_date, p.end_date, p.role, pr.name AS project_name,
           lower(public.unaccent(coalesce(p.name, ''))) AS nn,
           replace(lower(split_part(coalesce(p.email, ''), '@', 1)), '.', ' ') AS nl
    FROM profiles p
    LEFT JOIN projects pr ON pr.id = p.project_id
    WHERE role_filter IS NULL OR p.role = role_filter
  ),
  scored AS (
    SELECT c.*,
      CASE
        WHEN c.nn = n.nq OR c.nl = n.nq THEN 'exact'
        WHEN position(n.nq IN c.nn) > 0 THEN 'contains'
        WHEN NOT EXISTS (
          SELECT 1 FROM unnest(string_to_array(n.nq, ' ')) w
          WHERE w <> '' AND position(w IN c.nn) = 0
        ) THEN 'tokens'
        WHEN extensions.similarity(c.nn, n.nq) >= 0.3 THEN 'similar'
      END AS match_kind,
      extensions.similarity(c.nn, n.nq) AS score
    FROM c, n
    WHERE n.nq <> ''
  )
  SELECT id, name, email, start_date, end_date, role, project_name, match_kind, score
  FROM scored
  WHERE match_kind IS NOT NULL
  ORDER BY CASE match_kind WHEN 'exact' THEN 0 WHEN 'contains' THEN 1 WHEN 'tokens' THEN 2 ELSE 3 END,
           score DESC, name
  LIMIT greatest(1, least(max_results, 25));
$$;

-- Server-side only (chat-parse uses the service role). Not callable by app users.
REVOKE ALL ON FUNCTION public.search_profiles(text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_profiles(text, text, int) TO service_role;
