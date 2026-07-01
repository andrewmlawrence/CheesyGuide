# CheesyGuide Roadmap

## Robustness Before Rich Textbook Media

- Exercise multi-file uploads with at least two document types, including one intentionally unsupported file type.
- Confirm upload queue behavior for success, partial failure, retry, and delete-after-upload.
- Confirm Teacher answers cite documents, URL sources, and the Mentor Knowledge Textbook when relevant.
- Confirm source deletion removes the source from Source Management, Searchable Guide, and Teacher citations.
- Confirm Source Management search finds source titles, URL summaries, and Mentor Knowledge Textbook content.
- Add full-text extraction into Convex for uploaded documents if Source Management needs keyword search inside PDFs and Office files.
- Add clearer status history for uploaded documents: uploaded, queued for indexing, indexed, failed.
- Run `npx convex ai-files update` in a dedicated maintenance pass and review any guidance changes before committing them.

## Rich Mentor Knowledge Textbook Media

Goal: let mentors add images, GIFs, and links to the living Mentor Knowledge Textbook, then have Gemini place them into relevant textbook sections.

Recommended implementation:

- Store uploaded media files in Firebase Storage.
- Store media metadata in Convex: title, description, keywords, storage URL, file type, created date, and optional linked source.
- Extend Conversational Intake so mentors can attach media with a short description of what it shows and where it may belong.
- Change the textbook model from one large markdown body to structured sections with ordered content blocks.
- Support block types such as paragraph, heading, list, image, GIF, link, callout, and source citation.
- Ask Gemini to reorganize section blocks instead of rewriting raw markdown with embedded URLs.
- Render the source detail page with rich textbook components.

Open design questions:

- Should mentor-uploaded media be visible to students immediately, or only after a mentor confirms placement?
- Should the textbook keep an edit history or allow rollback after an AI reorganization?
- Should conflicting media descriptions trigger the same mentor decision flow as conflicting text guidance?
