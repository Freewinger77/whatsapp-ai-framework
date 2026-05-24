# Welcome to your Polymet AI project

## Project info

**Created with**: [Polymet AI](https://polymet.ai) - AI product designer

## How can I edit this code?

There are several ways of editing your application.

**Use Polymet AI**

Simply visit [Polymet AI](https://polymet.ai) and start designing or prompting.

Changes made via Polymet AI will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Polymet AI.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

You have multiple deployment options:

**Deploy with Polymet AI**

Simply open [Polymet AI](https://polymet.ai) and use the deployment features available in your project dashboard.

**Deploy with Vercel**

```sh
npm i -g vercel
vercel
```

**Deploy with Netlify**

```sh
npm run build
# Then drag and drop the 'dist' folder to netlify.com/drop
```

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| **Dev** | `npm run dev` | Start the development server with hot reload |
| **Build** | `npm run build` | Create an optimized production build |
| **Preview** | `npm run preview` | Serve the production build locally |
| **Type Check** | `npm run type-check` | Verify TypeScript types without emitting |
| **Lint** | `npm run lint` | Check code for linting errors |
| **Lint Fix** | `npm run lint:fix` | Automatically fix linting errors |
| **Format** | `npm run format` | Format code with Prettier |

## Library Versions

| Library | Version | Purpose |
|---------|---------|---------|
| React | 18.3.1 | UI framework |
| Vite | 6.2.0 | Build tool & dev server |
| TypeScript | 5.7.2 | Type safety |
| Tailwind CSS | 3.4.17 | Utility-first styling |
| React Router DOM | 6.26.2 | Client-side routing |
| Recharts | 2.12.7 | Data visualization |
| Zod | 3.23.8 | Schema validation |
