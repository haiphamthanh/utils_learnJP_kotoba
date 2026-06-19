# UI Style Guide

## 1. Design Goal

Build clean, modern, easy-to-use interfaces for utility web apps.
The UI should look professional, simple, responsive, and easy to extend.

## 2. Tech Preference

Use Tailwind CSS and daisyUI for simple HTML projects.
Use Tailwind CSS and shadcn/ui for React or Next.js projects.

## 3. Layout Rules

- Use a max-width container for normal pages.
- Use sidebar layout for dashboard/admin pages.
- Use card-based sections.
- Keep spacing generous.
- Avoid dense UI.
- Mobile layout must work first.

## 4. Visual Style

- Use rounded corners.
- Use soft borders.
- Use subtle shadows only when useful.
- Prefer neutral background.
- Use one primary accent color.
- Avoid too many colors.

## 5. Typography

- Page title: large and clear.
- Section title: medium and bold.
- Body text: readable and not too small.
- Use clear labels for form fields.

## 6. Components

Prefer existing components:

- Button
- Card
- Navbar
- Sidebar
- Table
- Badge
- Alert
- Modal
- Tabs
- Dropdown
- Form input
- Empty state
- Loading state

## 7. UX Rules

Every page should include:

- clear page title
- short description
- main action button
- useful empty state
- visible error state
- loading state if data is fetched

## 8. AI Coding Rules

- Do not create random CSS when framework classes are enough.
- Reuse components.
- Keep class names consistent.
- Avoid inline styles.
- Keep HTML semantic.
- Make the UI responsive.