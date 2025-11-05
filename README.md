# Tote Inventory Management App

A React-based application for managing tote storage and inventory with image support and local storage persistence.

## Features

- **Tote Management**: Create, edit, and delete totes with custom names
- **Shelf Positioning**: Assign totes to specific shelf positions (A1-G5)
- **Item Tracking**: Add items to totes with photos and descriptions
- **Image Support**: Upload and view photos for each item
- **Search Functionality**: Search across totes, positions, and items
- **Local Storage**: Data persists between sessions using browser localStorage
- **Responsive Design**: Works on desktop and mobile devices

## Shelf Positions

The app supports 26 shelf positions organized as follows:
- **A Row**: A1, A2, A3, A4, A5
- **B Row**: B1, B2, B3, B4, B5
- **C Row**: C4, C5
- **D Row**: D4, D5
- **E Row**: E4, E5
- **F Row**: F1, F2, F3, F4, F5
- **G Row**: G1, G2, G3, G4, G5

## Getting Started

### Prerequisites
- Node.js (version 14 or higher)
- npm or yarn package manager

### Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Building for Production

Build the app for production:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## Usage

### Adding a New Tote

1. Click the "Add Tote" button
2. Enter a name for your tote (e.g., "Holiday Decorations")
3. Select a shelf position from the dropdown
4. Add items to the tote:
   - Enter an item name
   - Optionally upload a photo
   - Click "Add" to add the item to the list
5. Click "Save Tote" to store the tote

### Viewing Tote Contents

- Click on any tote card in the main view to see detailed contents
- View all items with their photos and names
- Use the edit or delete buttons to modify the tote

### Searching

Use the search bar to find:
- Totes by name
- Items by name
- Totes by shelf position

### Managing Items

- **Add Photos**: Click the camera icon when adding items
- **Remove Items**: Click the X button next to any item in the tote editor
- **Edit Totes**: Use the edit button in the tote detail view

## Data Storage

All data is stored locally in your browser using localStorage. This means:
- Data persists between browser sessions
- Data is specific to each browser/device
- No internet connection required
- Data is not synchronized across devices

## Technology Stack

- **React 18**: Frontend framework
- **Vite**: Build tool and development server
- **Tailwind CSS**: Styling framework
- **Lucide React**: Icon library
- **Local Storage**: Data persistence

## Future Enhancements

- QR code generation for totes
- Export/import functionality
- Cloud storage integration
- Mobile app version
- Barcode scanning for items

## Troubleshooting

### Development Server Won't Start
- Ensure Node.js is installed
- Run `npm install` to install dependencies
- Check that port 3000 is available

### Images Not Loading
- Ensure uploaded images are in supported formats (JPEG, PNG, WebP)
- Check browser console for any errors

### Data Lost
- Data is stored in browser localStorage
- Clearing browser data will delete all totes and items
- Export functionality will be added in future versions