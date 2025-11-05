import { createClient } from '@supabase/supabase-js'

// Supabase configuration
const supabaseUrl = 'https://ysawbtgqwfklgjjunvse.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzYXdidGdxd2ZrbGdqanVudnNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyOTg5ODcsImV4cCI6MjA3Nzg3NDk4N30.5SNaz58_EFUmG6lBPMTnhbdvLsNjw6WNH3DSoPtXGqs'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database service functions
export const dbService = {
  // Test database connection
  async testConnection() {
    try {
      const { data, error } = await supabase
        .from('totes')
        .select('count', { count: 'exact', head: true });
      
      if (error) {
        console.error('Database connection test failed:', error);
        return false;
      }
      console.log('Database connection successful');
      return true;
    } catch (error) {
      console.error('Database connection error:', error);
      return false;
    }
  },

  // Get all totes
  async getTotes() {
    try {
      console.log('Fetching totes from Supabase...');
      const { data, error } = await supabase
        .from('totes')
        .select('*')
        .order('created_at', { ascending: true });
      
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      console.log('Successfully fetched totes:', data);
      return data || [];
    } catch (error) {
      console.error('Error fetching totes from Supabase:', error);
      console.log('Falling back to localStorage...');
      // Fallback to localStorage if Supabase fails
      return this.getLocalTotes();
    }
  },

  // Save a tote
  async saveTote(tote) {
    try {
      console.log('Saving tote to Supabase:', tote);
      
      // For new totes, don't include the ID (let database generate it)
      const toteToSave = { ...tote };
      if (!toteToSave.id || typeof toteToSave.id === 'number') {
        delete toteToSave.id;
      }
      
      const { data, error } = await supabase
        .from('totes')
        .upsert(toteToSave)
        .select()
        .single();
      
      if (error) {
        console.error('Supabase save error:', error);
        throw error;
      }
      
      console.log('Successfully saved tote:', data);
      return data;
    } catch (error) {
      console.error('Error saving tote to Supabase:', error);
      console.log('Falling back to localStorage...');
      // Fallback to localStorage
      this.saveLocalTote(tote);
      return tote;
    }
  },

  // Delete a tote
  async deleteTote(id) {
    try {
      const { error } = await supabase
        .from('totes')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    } catch (error) {
      console.error('Error deleting tote:', error);
      // Fallback to localStorage
      this.deleteLocalTote(id);
    }
  },

  // Upload image to Supabase Storage
  async uploadImage(file, fileName) {
    try {
      const { data, error } = await supabase.storage
        .from('tote-images')
        .upload(fileName, file);

      if (error) throw error;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('tote-images')
        .getPublicUrl(fileName);

      return urlData.publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      // Fallback to base64 encoding for localStorage
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    }
  },

  // localStorage fallback functions
  getLocalTotes() {
    try {
      const data = localStorage.getItem('totes-inventory');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveLocalTote(tote) {
    try {
      const totes = this.getLocalTotes();
      const existingIndex = totes.findIndex(t => t.id === tote.id);
      
      if (existingIndex >= 0) {
        totes[existingIndex] = tote;
      } else {
        totes.push(tote);
      }
      
      localStorage.setItem('totes-inventory', JSON.stringify(totes));
    } catch (error) {
      console.error('Error saving to localStorage:', error);
    }
  },

  deleteLocalTote(id) {
    try {
      const totes = this.getLocalTotes();
      const filtered = totes.filter(t => t.id !== id);
      localStorage.setItem('totes-inventory', JSON.stringify(filtered));
    } catch (error) {
      console.error('Error deleting from localStorage:', error);
    }
  },

  // Subscribe to real-time changes
  subscribeToChanges(callback) {
    try {
      const subscription = supabase
        .channel('totes_changes')
        .on('postgres_changes', 
          { event: '*', schema: 'public', table: 'totes' }, 
          callback
        )
        .subscribe();

      return subscription;
    } catch (error) {
      console.error('Error setting up real-time subscription:', error);
      return null;
    }
  }
};