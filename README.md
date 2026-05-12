# PDF Compressor - Frontend Only Version

A pure browser-based PDF compression tool that can be deployed to Vercel.

## Tech Stack

- **Frontend**: Vanilla JS + CSS
- **PDF Processing**: pdf-lib (runs entirely in browser)
- **Deployment**: Vercel (static + serverless functions)

## Features

- Drag & drop PDF upload
- Three compression levels: Light, Standard, Extreme
- Batch processing
- Download compressed files

## Local Development

```bash
npm install
npm start
```

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

## How Compression Works

The tool uses pdf-lib to optimize PDFs by:
1. Removing duplicate fonts and resources
2. Flattening annotations
3. Removing document metadata
4. Optimizing PDF structure

For image-heavy PDFs, additional compression is applied via canvas resampling.

## Note

This is a client-side only solution. No server-side processing required.
