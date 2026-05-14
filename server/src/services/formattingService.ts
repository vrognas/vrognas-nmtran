/**
 * Formatting Service
 * 
 * Provides basic document formatting capabilities for NMTRAN files.
 * Only handles control record positioning and basic continuation line indentation.
 */

import { Connection, TextEdit, Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { splitLines } from '../utils/text';

export class FormattingService {
  private connection: Connection;
  private static readonly DEFAULT_INDENT_SIZE = 2;
  private static readonly ASSIGNMENT_CONTEXTS = ['$PK', '$DES', '$ERROR', '$PRED'];

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Formats the entire document with basic formatting only
   * @param document The text document to format
   * @param indentSize Number of spaces for indentation (2 or 4)
   */
  formatDocument(document: TextDocument, indentSize: number = FormattingService.DEFAULT_INDENT_SIZE): TextEdit[] {
    try {
      const text = document.getText();
      const lines = splitLines(text);
      const edits: TextEdit[] = [];

      let currentIndentLevel = 0;
      let currentControlRecord = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const trimmedLine = line.trim();
        
        // Skip empty lines and comments
        if (trimmedLine.length === 0 || trimmedLine.startsWith(';')) continue;

        let expectedLine = '';
        let needsEdit = false;

        // Format control records (ensure they start at column 0)
        if (trimmedLine.startsWith('$')) {
          expectedLine = trimmedLine;
          needsEdit = (line !== expectedLine);
          currentIndentLevel = 0; // Reset indentation for new control record
          currentControlRecord = trimmedLine.split(/\s+/)[0]?.toUpperCase() || ''; // Track current control record
        }
        // Handle IF/THEN/ELSE/ENDIF indentation
        else if (trimmedLine.length > 0) {
          // Check if this line decreases indentation (ELSE, ELSEIF, ENDIF)
          if (/^(ELSE|ELSEIF|ENDIF)\b/i.test(trimmedLine)) {
            if (currentIndentLevel > 0) currentIndentLevel--;
          }

          // Calculate expected indentation
          const indent = ' '.repeat(Math.max(0, currentIndentLevel) * indentSize + indentSize); // Base + conditional indent
          expectedLine = indent + trimmedLine;
          needsEdit = (line !== expectedLine);

          // Check if this line increases indentation (IF...THEN, ELSEIF...THEN)
          if (/^(IF|ELSEIF)\b.*\bTHEN\s*$/i.test(trimmedLine)) {
            currentIndentLevel++;
          }
          // Handle ELSE (decreases then increases)
          else if (/^ELSE\s*$/i.test(trimmedLine)) {
            currentIndentLevel++;
          }
        }

        // Apply operator formatting to the expected line if we're in the right context
        if (currentControlRecord && FormattingService.ASSIGNMENT_CONTEXTS.includes(currentControlRecord)) {
          expectedLine = this.formatAssignmentOperators(expectedLine);
        }
        expectedLine = this.formatArithmeticAndComparisonOperators(expectedLine);
        
        if (needsEdit || line !== expectedLine) {
          edits.push({
            range: Range.create(i, 0, i, line.length),
            newText: expectedLine
          });
        }
      }

      if (process.env.NODE_ENV === 'development') {
        this.connection.console.log(
          `🎨 Formatted document with ${edits.length} changes using ${indentSize}-space indentation`,
        );
      }
      return edits;

    } catch (error) {
      this.connection.console.error(`❌ Error formatting document: ${error}`);
      return [];
    }
  }

  /**
   * Formats a specific range in the document
   * @param document The text document to format
   * @param range The range to format
   * @param indentSize Number of spaces for indentation (2 or 4)
   */
  formatRange(document: TextDocument, range: Range, indentSize: number = FormattingService.DEFAULT_INDENT_SIZE): TextEdit[] {
    try {
      const allEdits = this.formatDocument(document, indentSize);
      return allEdits.filter(edit =>
        edit.range.start.line >= range.start.line &&
        edit.range.end.line <= range.end.line
      );
    } catch (error) {
      this.connection.console.error(`Error formatting range: ${error}`);
      return [];
    }
  }


  /**
   * Preserves leading whitespace while formatting the content
   */
  private preserveLeadingWhitespace(line: string, formatter: (content: string) => string): string {
    const leadingWhitespaceMatch = line.match(/^(\s*)/);
    const leadingWhitespace = leadingWhitespaceMatch?.[1] || '';
    const content = line.substring(leadingWhitespace.length);
    return leadingWhitespace + formatter(content);
  }

  /**
   * Formats assignment operators with proper spacing
   */
  private formatAssignmentOperators(line: string): string {
    return this.preserveLeadingWhitespace(line, (content) => {
      // Assignment operator: = (but not ==, !=, <=, >=)
      return content.replace(/(?<![=!<>])\s*=\s*(?!=)/g, ' = ');
    });
  }

  /**
   * Formats arithmetic and comparison operators with proper spacing
   */
  private formatArithmeticAndComparisonOperators(line: string): string {
    return this.preserveLeadingWhitespace(line, (content) => {
      let result = content;

      // Handle comparison operators
      // NMTRAN style (.EQ., .NE., .GT., .GE., .LT., .LE., .AND., .OR.)
      result = result.replace(/\s*(\.(EQ|NE|GT|GE|LT|LE|AND|OR|NOT)\.)\s*/gi, ' $1 ');
      
      // Fortran 95 style (==, /=, >, >=, <, <=)
      result = result.replace(/\s*(==|\/=|>=|<=|>|<)\s*/g, ' $1 ');

      // Arithmetic operators (+, -, *, /) but NOT ** (exponentiation)
      result = this.formatArithmeticOperators(result);

      return result;
    });
  }

  /**
   * Formats arithmetic operators with careful handling of unary minus
   */
  private formatArithmeticOperators(line: string): string {
    let result = line;

    // Handle multiplication and division (but not **)
    result = result.replace(/(?<!\*)\s*\*\s*(?!\*)/g, ' * ');
    result = result.replace(/\s*\/\s*/g, ' / ');

    // Handle addition
    result = result.replace(/\s*\+\s*/g, ' + ');

    // Handle subtraction/minus with careful unary minus detection
    result = this.formatMinusOperator(result);

    return result;
  }

  /**
   * Handles minus operator formatting with unary/binary distinction
   */
  private formatMinusOperator(line: string): string {
    let result = line;
    
    // Step 1: Preserve scientific notation (1E-2, 1E+2, 1E2)
    result = result.replace(/(\d+)\s*E\s*([+-]?)\s*(\d+)/gi, '$1E$2$3');
    
    // Step 2: Format binary minus - spaces around minus between operands (but not after E)
    result = result.replace(/(\w+|\d+|\))(?<!E)\s*-\s*(\w+|\d+|\()/g, '$1 - $2');
    
    // Step 3: Format unary minus after assignment - space before minus, none after
    result = result.replace(/=\s*-\s*/g, '= -');
    
    // Step 4: Clean up multiple spaces
    result = result.replace(/\s+/g, ' ');
    
    return result;
  }

}