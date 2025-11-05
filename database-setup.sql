-- Copy and paste this into Supabase SQL Editor and click "Run"

-- Create totes table
CREATE TABLE totes (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  items JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable real-time updates
ALTER PUBLICATION supabase_realtime ADD TABLE totes;