-- 046: Lead-gen scraper catalog — LinkedIn, ad libraries, SEO, social, e-commerce,
-- GovIndia (MCA/GST), WhatsApp, and contact-enrichment sources, feeding Graha (CRM).
--
-- Vehicle (Vahan/Parivahan) and Aadhaar are intentionally NOT seeded here:
--   - Vahan/Parivahan has no legitimate scraping path (CAPTCHA-gated NIC portal);
--     real access requires an official e-Vahan / Sarathi API tie-up.
--   - Aadhaar verification requires a UIDAI AUA/KUA license and the holder's
--     own OTP consent — there is no lawful third-party "scrape" of it. This
--     also matches the product's existing choice of in-house eSign over
--     Aadhaar-based flows.

ALTER TABLE staging.hub_scraper_catalog ADD COLUMN IF NOT EXISTS graha_field_map JSONB NOT NULL DEFAULT '{}';

ALTER TABLE staging.hub_scraper_runs ADD COLUMN IF NOT EXISTS graha_imported_count INTEGER DEFAULT 0;
ALTER TABLE staging.hub_scraper_runs ADD COLUMN IF NOT EXISTS graha_imported_at TIMESTAMPTZ;

INSERT INTO staging.hub_scraper_catalog
    (id, name, description, icon, category, apify_actor_id, input_schema,
     cost_per_run, price_inr, margin_pct, max_results, graha_field_map)
VALUES
    ('linkedin_company_employees', 'LinkedIn Company Employees',
     'Find people working at a target company on LinkedIn — no cookies needed.',
     '💼', 'linkedin', 'harvestapi/linkedin-company-employees',
     '[{"name":"companies","label":"Company names or LinkedIn URLs (one per line)","type":"textarea","split_lines":true,"required":true},
       {"name":"maxItems","label":"Max results","type":"number","default":50}]',
     0.45, 150, 70, 50,
     '{"name":"name","company":"currentCompany","designation":"headline","email":"email"}'),

    ('linkedin_profile_search', 'LinkedIn Profile Search',
     'Search LinkedIn profiles by title, location or company — no cookies needed.',
     '🔎', 'linkedin', 'harvestapi/linkedin-profile-search',
     '[{"name":"searchQuery","label":"Search query (name, role, keyword)","type":"text","required":true},
       {"name":"locations","label":"Locations (one per line, optional)","type":"textarea","split_lines":true},
       {"name":"currentJobTitles","label":"Job titles (one per line, optional)","type":"textarea","split_lines":true},
       {"name":"maxItems","label":"Max results","type":"number","default":25}]',
     0.15, 80, 70, 25,
     '{"name":"name","company":"currentCompany","designation":"headline"}'),

    ('google_ads_competitor', 'Google Ads — Competitor Ad Copies',
     'Scrape a competitor''s running ads from the Google Ads Transparency Center.',
     '📢', 'google_ads', 'silva95gustavo/google-ads-scraper',
     '[{"name":"startUrls","label":"Google Ads Transparency Center URLs (one per line)","type":"textarea","split_lines":true,"url_objects":true,"required":true},
       {"name":"resultsLimit","label":"Max ads","type":"number","default":50}]',
     0.15, 60, 70, 50,
     '{"company":"advertiserName"}'),

    ('meta_ad_library', 'Meta Ad Library — Facebook & Instagram Ads',
     'Scrape a competitor''s running Facebook/Instagram ads from the Meta Ad Library.',
     '📣', 'meta_ads', 'curious_coder/facebook-ads-library-scraper',
     '[{"name":"urls","label":"Meta Ad Library search or page URLs (one per line)","type":"textarea","split_lines":true,"url_objects":true,"required":true},
       {"name":"count","label":"Max ads","type":"number","default":50}]',
     0.10, 50, 70, 50,
     '{"company":"pageName"}'),

    ('seo_serp_keywords', 'SEO — Google Search Results & Keywords',
     'Pull organic rankings, People-Also-Ask and related searches for a keyword list.',
     '🔍', 'seo', 'apidojo/google-search-scraper',
     '[{"name":"searchTerms","label":"Keywords (one per line)","type":"textarea","split_lines":true,"required":true},
       {"name":"countryCode","label":"Country code","type":"text","default":"in"},
       {"name":"maxItems","label":"Results per keyword","type":"number","default":20}]',
     0.10, 50, 70, 20,
     '{}'),

    ('instagram_profiles', 'Instagram Business Profiles',
     'Scrape public Instagram profile info — bio, followers, business category, website.',
     '📷', 'social', 'apify/instagram-profile-scraper',
     '[{"name":"usernames","label":"Instagram usernames (one per line)","type":"textarea","split_lines":true,"required":true}]',
     0.10, 50, 70, 20,
     '{"name":"fullName","company":"businessCategoryName","email":"businessEmail","phone":"businessPhoneNumber"}'),

    ('twitter_x_profile', 'X (Twitter) Business Profile',
     'Look up a single public X/Twitter profile — bio, followers, verification, links.',
     '🐦', 'social', 'data-slayer/twitter-user',
     '[{"name":"username","label":"X (Twitter) username","type":"text","required":true}]',
     0.05, 30, 70, 1,
     '{"name":"name"}'),

    ('amazon_india_products', 'Amazon India — Products & Sellers',
     'Search Amazon.in listings for product, price and seller data.',
     '🛒', 'ecommerce', 'codingfrontend/amazon-product-scraper',
     '[{"name":"searchQuery","label":"Search term","type":"text","required":true},
       {"name":"maxItems","label":"Max results","type":"number","default":30}]',
     0.20, 70, 70, 30,
     '{}'),

    ('flipkart_products', 'Flipkart — Products & Listings',
     'Search Flipkart listings by keyword for price, MRP, discount and seller data.',
     '🛍️', 'ecommerce', 'piotrv1001/flipkart-listings-scraper',
     '[{"name":"searchQueries","label":"Search terms (one per line)","type":"textarea","split_lines":true,"required":true},
       {"name":"maxItemsPerInput","label":"Max results per term","type":"number","default":30}]',
     0.15, 60, 70, 30,
     '{}'),

    ('mca_company_lookup', 'GovIndia — MCA Company Registry',
     'Look up Indian company master data by name, state or RoC (Ministry of Corporate Affairs).',
     '🏛️', 'govindia', 'automation-lab/india-ogd-company-registry-scraper',
     '[{"name":"companyNames","label":"Company names (one per line)","type":"textarea","split_lines":true,"required":true},
       {"name":"maxResults","label":"Max results","type":"number","default":20}]',
     0.05, 40, 70, 20,
     '{"company":"companyName"}'),

    ('mca_cin_director_lookup', 'GovIndia — MCA Director Lookup (CIN)',
     'Look up company master data and directors by CIN (Ministry of Corporate Affairs).',
     '🏛️', 'govindia', 'thirdwatch/mca-india-scraper',
     '[{"name":"queries","label":"CIN numbers (one per line)","type":"textarea","split_lines":true,"required":true,"placeholder":"e.g. U72200KA2010PTC052954"},
       {"name":"maxResults","label":"Max results","type":"number","default":10}]',
     0.10, 50, 70, 10,
     '{"company":"companyName"}'),

    ('gst_verification', 'GovIndia — GST Verification (GSTIN)',
     'Verify a GSTIN and pull legal name, trade name, status and filing details from the GST portal.',
     '🧾', 'govindia', 'mikolabs/gstin-scraper',
     '[{"name":"gstins","label":"GSTIN numbers (one per line)","type":"textarea","split_lines":true,"required":true}]',
     0.10, 50, 70, 10,
     '{"company":"legalName"}'),

    ('whatsapp_number_lookup', 'WhatsApp Business Lookup',
     'Check whether a phone number is on WhatsApp/WhatsApp Business and pull its public profile.',
     '💬', 'whatsapp', 'vero-api/whatsapp-scraper',
     '[{"name":"numbers","label":"Phone numbers with country code (one per line)","type":"textarea","split_lines":true,"required":true,"placeholder":"e.g. +919812345678"}]',
     0.15, 60, 70, 20,
     '{"name":"displayName","phone":"number","company":"businessName"}'),

    ('company_email_finder', 'Business Email Finder',
     'Find verified business emails (CEO/CTO/sales) for a company domain — Lusha/Apollo-style enrichment.',
     '✉️', 'enrichment', 'nexgendata/company-email-finder',
     '[{"name":"domains","label":"Company domains (one per line)","type":"textarea","split_lines":true,"required":true,"placeholder":"e.g. acme.com"}]',
     1.05, 350, 65, 10,
     '{"email":"email","name":"name","designation":"title","company":"domain"}'),

    ('website_contact_finder', 'Website Contact Finder',
     'Crawl a website for email addresses, phone numbers and social links.',
     '🌐', 'enrichment', 'makework36/email-finder-scraper',
     '[{"name":"urls","label":"Website URLs (one per line)","type":"textarea","split_lines":true,"url_objects":true,"required":true}]',
     0.15, 60, 70, 20,
     '{"email":"email","phone":"phone","company":"url"}')
ON CONFLICT (id) DO NOTHING;
