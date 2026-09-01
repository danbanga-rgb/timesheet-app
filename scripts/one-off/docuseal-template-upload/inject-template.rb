# frozen_string_literal: true
#
# Runs inside the DocuSeal container via `bin/rails runner`. Reads
# /tmp/upload.pdf, extracts {{tag}} positions via pdfium, creates a Template
# with an attached document, and injects one field record per tag directly
# into template.fields — bypassing DocuSeal's AcroForm-only auto-detect.
#
# Tag syntax expected:
#   {{name;role=Role;type=type;required=true}}
#   {{name;role=Role;type=type;defaultValue=X}}
#
# Roles map to DocuSeal submitters. Standard roles used by our templates:
#   ContractsTeam, Vendor, GeneralManager.

require 'securerandom'

TEMPLATE_NAME = ENV.fetch('TEMPLATE_NAME')
PDF_PATH = '/tmp/upload.pdf'

# ---------- extract tag positions from the PDF ----------

TagPosition = Struct.new(:name, :role, :type, :required, :default_value,
                         :page, :x, :y, :w, :h,
                         :width_pts, :height_pts, :valign, :format)

# Tag syntax: {{name;role=X;type=Y;required=true;defaultValue=Z;width=N;height=N;valign=V;format=F}}
# Only 'name' is required. Overrides:
#   width=N, height=N — points (1pt = 1/72 inch). Overrides computed bbox.
#   valign=top|center|bottom — vertical alignment of filled value.
#   format=STRING — date format tokens (MMMM D, YYYY etc.). Date fields only.
def parse_tag_attrs(tag)
  inner = tag.sub(/\A\{\{/, '').sub(/\}\}\z/, '')
  parts = inner.split(';')
  name = parts.shift
  attrs = {
    role: 'Party', type: 'text', required: false, default_value: nil,
    width_pts: nil, height_pts: nil, valign: nil, format: nil
  }
  parts.each do |kv|
    k, v = kv.split('=', 2)
    case k
    when 'role' then attrs[:role] = v
    when 'type' then attrs[:type] = v
    when 'required' then attrs[:required] = (v == 'true')
    when 'defaultValue' then attrs[:default_value] = v
    when 'width' then attrs[:width_pts] = v.to_f
    when 'height' then attrs[:height_pts] = v.to_f
    when 'valign' then attrs[:valign] = v
    when 'format' then attrs[:format] = v
    end
  end
  [name, attrs]
end

positions = []
# Pattern for repeating-footer initials placeholder: literal "Initials"
# followed by whitespace + 3+ underscores. Placed as a per-page Vendor
# Initials field. Cannot be handled via DOCX merge tag because DOCX
# footers repeat; one tag would produce one field, not one-per-page.
INITIALS_PATTERN = /Initials\s+_{3,}/

# Column-clustering to prevent tag interleaving in multi-column tables.
# Pdfium reads characters in (y, x) order, so two tags on adjacent table
# cells at the same y-band get their characters interleaved when text
# wraps. We cluster text_objects by their x-left-edge into columns
# (buckets 10% wide) then read column-by-column, y-sorted within each.
COLUMN_BUCKET_WIDTH = 0.1

doc = Pdfium::Document.open_file(PDF_PATH)
doc.page_count.times do |page_idx|
  page = doc.get_page(page_idx)

  # ---- Column-clustered tag extraction using text_objects ----
  objects = page.text_objects.to_a
  # Group text_objects by x-left-edge bucket, then sort within bucket by y.
  by_column = objects.group_by { |o| (o.x / COLUMN_BUCKET_WIDTH).to_i }

  # Read text_nodes once so we can compute precise bboxes from characters
  # (not from text_object bounding boxes, which cover whole runs including
  # surrounding non-tag text like "Name: " or "By: ").
  all_nodes = page.text_nodes.to_a

  by_column.keys.sort.each do |bucket|
    col_objects = by_column[bucket].sort_by(&:y)
    col_text = col_objects.map { |o| o.content.to_s }.join

    col_text.enum_for(:scan, /\{\{[^}]+\}\}/).each do
      m = Regexp.last_match
      tag_str = col_text[m.begin(0)...m.end(0)]

      # Find text_nodes spatially inside any of the column's text_objects
      # (any object could hold pieces of the tag). Sort by (y, x) reading order.
      candidate_nodes = all_nodes.select do |n|
        cx = n.x + n.w / 2.0
        cy = n.y + n.h / 2.0
        col_objects.any? do |obj|
          cx >= obj.x - 0.001 && cx <= obj.x + obj.w + 0.001 &&
            cy >= obj.y - 0.001 && cy <= obj.y + obj.h + 0.001
        end
      end.sort_by { |n| [n.y, n.x] }

      # Find the exact tag substring within these nodes' character stream
      node_text = candidate_nodes.map { |n| n[:content] }.join
      idx = node_text.index(tag_str)

      if idx
        slice = candidate_nodes[idx...idx + tag_str.length]
        x0 = slice.map(&:x).min
        y0 = slice.map(&:y).min
        x1 = slice.map { |n| n.x + n.w }.max
        y1 = slice.map { |n| n.y + n.h }.max
      else
        # Fallback (should be rare): use the involved objects' union bbox.
        # This over-covers surrounding text but keeps the pipeline alive.
        involved = col_objects.select { |o| o.content.to_s.include?(tag_str[0, 30]) }
        involved = col_objects if involved.empty?
        x0 = involved.map(&:x).min
        y0 = involved.map(&:y).min
        x1 = involved.map { |o| o.x + o.w }.max
        y1 = involved.map { |o| o.y + o.h }.max
      end

      name, attrs = parse_tag_attrs(tag_str)
      positions << TagPosition.new(
        name, attrs[:role], attrs[:type], attrs[:required], attrs[:default_value],
        page_idx, x0, y0, x1 - x0, y1 - y0,
        attrs[:width_pts], attrs[:height_pts], attrs[:valign], attrs[:format]
      )
    end
  end

  # ---- Initials via text_nodes (footer is single-column, no interleave risk) ----
  nodes = page.text_nodes.to_a
  text = nodes.sort_by { |n| [n.y, n.x] }.map { |n| n[:content] }.join
  sorted_nodes = nodes.sort_by { |n| [n.y, n.x] }

  text.enum_for(:scan, INITIALS_PATTERN).each do
    m = Regexp.last_match
    underscore_start = m.begin(0) + m[0].index('_')
    slice = sorted_nodes[underscore_start...m.end(0)]
    next if slice.empty?

    x0 = slice.map(&:x).min
    y0 = slice.map(&:y).min
    x1 = slice.map { |n| n.x + n.w }.max
    y1 = slice.map { |n| n.y + n.h }.max

    positions << TagPosition.new(
      "initials_p#{page_idx + 1}", 'Vendor', 'initials', true, nil,
      page_idx, x0, y0, x1 - x0, y1 - y0,
      nil, nil, nil, nil
    )
  end
end
doc.close

puts "Extracted #{positions.length} tag positions from #{PDF_PATH}"

# ---------- redact tag text from PDF (draw white rectangles) ----------
# DocuSeal's field overlay does NOT hide underlying PDF text, so we
# whiteout each {{tag}} region before upload. Fields still get placed at
# the same normalized coords on the cleaned PDF.

require 'hexapdf'

CLEAN_PDF_PATH = '/tmp/upload-clean.pdf'
PADDING_PTS = 1.5 # small expansion to fully cover glyph edges

hex_doc = HexaPDF::Document.open(PDF_PATH)
hex_doc.pages.each_with_index do |page, page_idx|
  page_positions = positions.select { |p| p.page == page_idx }
  next if page_positions.empty?

  media_box = page.box(:media)
  page_w = media_box.width
  page_h = media_box.height

  canvas = page.canvas(type: :overlay)
  canvas.fill_color(255, 255, 255)
  page_positions.each do |pos|
    x_pt = (pos.x * page_w) - PADDING_PTS
    y_pt = ((1.0 - pos.y - pos.h) * page_h) - PADDING_PTS
    w_pt = (pos.w * page_w) + (2 * PADDING_PTS)
    h_pt = (pos.h * page_h) + (2 * PADDING_PTS)
    canvas.rectangle(x_pt, y_pt, w_pt, h_pt).fill
  end
end
hex_doc.write(CLEAN_PDF_PATH, optimize: true)
puts "Redacted PDF written to #{CLEAN_PDF_PATH}"

# ---------- delete any prior template of the same name (idempotent) ----------

Template.where(name: TEMPLATE_NAME).destroy_all

# ---------- create template + attach PDF ----------

user = User.first
account = user.account

uploaded_file = ActionDispatch::Http::UploadedFile.new(
  tempfile: File.open(CLEAN_PDF_PATH, 'rb'),
  filename: "#{TEMPLATE_NAME}.pdf",
  type: 'application/pdf'
)

template = Template.new
template.account = account
template.author = user
template.folder = TemplateFolders.find_or_create_by_name(user, nil)
template.name = TEMPLATE_NAME
Templates.maybe_assign_access(template) if Templates.respond_to?(:maybe_assign_access)
template.save!

documents, = Templates::CreateAttachments.call(template, { files: [uploaded_file] }, extract_fields: false)
attachment_uuid = documents.first.uuid

# ---------- build submitters (one per distinct role) ----------
# Human-readable role labels shown in DocuSeal signing UI. Falls back to
# the raw role name if not mapped.
SUBMITTER_LABELS = {
  'Vendor'         => 'Vendor Signer',
  'GeneralManager' => 'Synergie Countersigner',
  'ContractsTeam'  => 'Contracts Team',
}.freeze

roles = positions.map(&:role).uniq
submitters = roles.map { |role| { 'name' => SUBMITTER_LABELS[role] || role, 'uuid' => SecureRandom.uuid } }
submitter_uuid_by_role = roles.zip(submitters.map { |s| s['uuid'] }).to_h

# ---------- build fields ----------
# Per-page initials stay as SEPARATE fields (initials_p1, initials_p2, ...)
# so each requires its own explicit click by the signer. Consolidating
# into one field with N areas would auto-propagate the value and defeat
# the legal purpose of per-page acknowledgement.

# Page dimensions from the PDF are needed to convert points → normalized
# coords for width/height overrides. Assume US Letter (612 x 792 pt) for
# the whole document; verified against LibreOffice output. If we ever
# accept non-US-Letter templates, read per-page dims from HexaPDF.
PAGE_W_PTS = 612.0
PAGE_H_PTS = 792.0

DEFAULT_DATE_FORMAT = 'MMMM D, YYYY'
TEXT_FIELD_HEIGHT_MULTIPLIER = 2.0 # gives room for one wrap line

# Human-readable field titles shown as placeholder text in the signing UI.
# If a tag's field name isn't in the map, fall back to a title-cased version
# of the field name (better than the raw snake_case in most cases).
FIELD_TITLES = {
  'sig_synergie'      => 'Synergie Signature',
  'sig_vendor'        => 'Vendor Signature',
  'sig_sow_synergie'  => 'Synergie Signature (SOW)',
  'sig_sow_vendor'    => 'Vendor Signature (SOW)',
}.freeze

def pretty_title(field_name)
  return FIELD_TITLES[field_name] if FIELD_TITLES.key?(field_name)
  if (m = field_name.match(/\Ainitials_p(\d+)\z/))
    return "Initial — Page #{m[1]}"
  end
  field_name.tr('_', ' ').split.map(&:capitalize).join(' ')
end

fields = positions.map do |pos|
  # Width override
  w = pos.width_pts ? pos.width_pts / PAGE_W_PTS : pos.w

  # Height override / auto-inflation for text fields
  h = if pos.height_pts
        pos.height_pts / PAGE_H_PTS
      elsif pos.type == 'text'
        pos.h * TEXT_FIELD_HEIGHT_MULTIPLIER
      else
        pos.h
      end

  # Bottom-align text fields by default so overflow lines grow UP into
  # the empty space above (safer for signature blocks + standalone rows).
  valign = pos.valign || (pos.type == 'text' ? 'bottom' : nil)

  # Anchor y so the field's BOTTOM stays where the tag was in the DOCX.
  # (Field position uses top-left as origin, so shrink y upward when we
  # grew height.)
  y = pos.y + pos.h - h

  field = {
    'uuid' => SecureRandom.uuid,
    'name' => pos.name,                    # internal identifier (unchanged)
    'title' => pretty_title(pos.name),     # human-readable placeholder in signing UI
    'type' => pos.type,
    'required' => pos.required,
    'submitter_uuid' => submitter_uuid_by_role[pos.role],
    'areas' => [{
      'page' => pos.page,
      'x' => pos.x,
      'y' => y,
      'w' => w,
      'h' => h,
      'attachment_uuid' => attachment_uuid
    }]
  }
  field['default_value'] = pos.default_value if pos.default_value

  preferences = {}
  preferences['valign'] = valign if valign
  if pos.type == 'date'
    preferences['format'] = pos.format || DEFAULT_DATE_FORMAT
  elsif pos.format
    preferences['format'] = pos.format
  end
  field['preferences'] = preferences unless preferences.empty?

  field
end

schema = documents.map { |doc| { 'attachment_uuid' => doc.uuid, 'name' => doc.filename.base } }

template.submitters = submitters
template.fields = fields
template.schema = schema
template.save!

puts '---RESULT---'
puts "Template id=#{template.id} slug=#{template.slug}"
puts "Submitters: #{submitters.map { |s| s['name'] }.join(', ')}"
puts "Fields: #{fields.length}"
fields.each do |f|
  role = submitters.find { |s| s['uuid'] == f['submitter_uuid'] }['name']
  puts "  #{f['name']}  type=#{f['type']}  role=#{role}  required=#{f['required']}"
end
puts "URL: http://localhost:3000/templates/#{template.id}"
