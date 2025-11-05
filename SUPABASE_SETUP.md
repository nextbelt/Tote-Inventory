# 🚀 Supabase Setup Guide for Tote Inventory

## Quick Setup (5 minutes):

### 1. Create Supabase Account
- Go to [supabase.com](https://supabase.com)
- Sign up with GitHub (free)
- Create a new project called "tote-inventory"

### 2. Create Database Table
In your Supabase dashboard, go to SQL Editor and run:

```sql
-- Create totes table
CREATE TABLE totes (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  items JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create storage bucket for images
INSERT INTO storage.buckets (id, name, public) VALUES ('tote-images', 'tote-images', true);

-- Enable real-time
ALTER PUBLICATION supabase_realtime ADD TABLE totes;
```

### 3. Get Your Keys
From your Supabase dashboard:
- Go to Settings → API
- Copy your Project URL and Anon Public Key

### 4. Update Configuration
Edit `src/supabase.js` and replace:
```javascript
const supabaseUrl = 'YOUR_PROJECT_URL_HERE'
const supabaseAnonKey = 'YOUR_ANON_KEY_HERE'
```

### 5. Set Storage Permissions
**Use Dashboard Method (Recommended):**

1. **Go to Storage → tote-images bucket**
2. **Click on "Policies" tab**
3. **Click "New Policy" button**

**Create Policy #1: View Images**
- Click "Get started quickly" → "SELECT"
- Policy name: `Public image access`
- Allowed operation: `SELECT`
- Target roles: Leave as `public`
- Policy definition: `true` (allows all)

**Create Policy #2: Upload Images**
- Click "New Policy" → "Get started quickly" → "INSERT" 
- Policy name: `Allow image uploads`
- Allowed operation: `INSERT`
- Target roles: Leave as `public`
- Policy definition: `true` (allows all)

**Create Policy #3: Delete Images**
- Click "New Policy" → "Get started quickly" → "DELETE"
- Policy name: `Allow image deletion`
- Allowed operation: `DELETE` 
- Target roles: Leave as `public`
- Policy definition: `true` (allows all)

⚠️ **Important**: Don't use the SQL method - it requires database owner permissions which regular users don't have.

## ✅ What You Get:

- **Real-time sync** - Both devices see changes instantly
- **Cloud storage** - Images stored securely online
- **Backup** - Data is automatically backed up
- **Multi-device** - Use on phones, tablets, computers
- **Offline fallback** - Still works if internet is down

## 🔄 Migration from localStorage:

Your existing data will automatically stay as fallback. Once Supabase is configured, you can manually re-add your totes to sync them to the cloud.

## 💾 Free Tier Limits:

**Supabase Free Tier:**
- **Database**: 500MB (plenty for thousands of totes)
- **File Storage**: 1GB (NOT 50MB - that's plenty for photos!)
- **Bandwidth**: 5GB/month
- **Requests**: 2 million/month

**Storage Math for Your Use Case:**
- Average phone photo: ~2-3MB
- 1GB storage = ~300-500 photos
- Perfect for home inventory!

## 🔄 Alternative: Skip Cloud Setup For Now

**Option 1: Deploy with localStorage (Recommended for now)**
- Your app works perfectly as-is
- Deploy to Netlify/Vercel today
- Add cloud sync later when you have time

**Option 2: Simple Image Compression**
- Keep using localStorage
- Compress images automatically
- Much simpler setup

## 📱 Quick Deploy Steps (No Supabase needed):

1. Go to [netlify.com](https://netlify.com)
2. Drag your `dist` folder to deploy
3. Get instant URL!
4. Use on both phones via the URL

**Benefits:**
- ✅ Works immediately
- ✅ No setup complexity  
- ✅ Still functional for inventory
- ✅ Add cloud sync later if needed