# English word ranks

`en-ranks.txt` lists the 30,000 most frequent English words, most frequent
first, one per line. Lingo uses the line number as a word's rank to decide
which words to highlight for a reader's chosen vocabulary size.

Source: [wordfreq](https://github.com/rspeer/wordfreq) 3.1.1 by Robyn Speer,
`wordfreq/data/large_en.msgpack.gz`. Only lowercase alphabetic entries were
kept, in their original order; frequencies were dropped.

The wordfreq data is licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).
This derived list is distributed under the same license. It includes data
from Google Books Ngrams, Wikipedia, OpenSubtitles, the Leeds Internet Corpus,
SUBTLEX, and other sources credited in the wordfreq README.
