import { TaskAnalysis, TrelloCard } from './types.js';

export class TaskAnalyzer {
  private static readonly VAGUE_INDICATORS = [
    'somehow', 'maybe', 'probably', 'might', 'could', 'should', 'would',
    'etc', 'and so on', 'whatever', 'stuff', 'things', 'handle', 'deal with',
    'figure out', 'look into', 'check', 'review', 'improve', 'optimize',
    'better', 'nice', 'good', 'clean up'
  ];

  private static readonly COMPLEXITY_KEYWORDS = [
    'implement', 'create', 'build', 'develop', 'design', 'refactor',
    'integrate', 'migrate', 'upgrade', 'optimize', 'configure'
  ];

  private static readonly ACTION_VERBS = [
    'add', 'remove', 'update', 'create', 'delete', 'implement', 'fix',
    'test', 'deploy', 'configure', 'setup', 'install', 'build', 'design'
  ];

  static analyzeTask(card: TrelloCard): TaskAnalysis {
    const text = `${card.name} ${card.desc}`.toLowerCase();
    const words = text.split(/\s+/);
    
    // Calculate complexity
    const complexity = this.calculateComplexity(text, words);
    
    // Check for vague language
    const vagueWords = this.findVagueWords(words);
    const isVague = vagueWords.length > 0 || this.hasVagueStructure(text);
    
    // Detect multiple actions
    const multipleActions = this.hasMultipleActions(text);
    
    // Check for missing details
    const missingDetails = this.findMissingDetails(text, card);
    
    // Generate suggestions
    const suggestedSplits = multipleActions ? this.suggestTaskSplits(card) : undefined;
    const clarifyingQuestions = isVague ? this.generateClarifyingQuestions(card, vagueWords, missingDetails) : undefined;

    return {
      complexity,
      isVague,
      suggestedSplits,
      clarifyingQuestions,
      indicators: {
        lengthScore: this.calculateLengthScore(text),
        vagueWords,
        multipleActions,
        missingDetails
      }
    };
  }

  private static calculateComplexity(text: string, words: string[]): 'simple' | 'moderate' | 'complex' {
    let complexityScore = 0;
    
    // Length factor
    if (words.length > 20) complexityScore += 2;
    else if (words.length > 10) complexityScore += 1;
    
    // Complexity keywords
    const complexKeywords = this.COMPLEXITY_KEYWORDS.filter(keyword => text.includes(keyword));
    complexityScore += complexKeywords.length;
    
    // Multiple actions
    if (this.hasMultipleActions(text)) complexityScore += 2;
    
    // Technical terms (simple heuristic)
    const techTerms = ['api', 'database', 'server', 'client', 'authentication', 'security', 'algorithm'];
    const techTermsFound = techTerms.filter(term => text.includes(term)).length;
    complexityScore += techTermsFound;

    if (complexityScore >= 5) return 'complex';
    if (complexityScore >= 2) return 'moderate';
    return 'simple';
  }

  private static findVagueWords(words: string[]): string[] {
    return words.filter(word => this.VAGUE_INDICATORS.includes(word));
  }

  private static hasVagueStructure(text: string): boolean {
    // Check for vague sentence structures
    const vaguePatterns = [
      /make.*better/,
      /improve.*somehow/,
      /fix.*issues?/,
      /handle.*properly/,
      /deal with.*problem/,
      /look into.*$/
    ];
    
    return vaguePatterns.some(pattern => pattern.test(text));
  }

  private static hasMultipleActions(text: string): boolean {
    const actionVerbs = this.ACTION_VERBS.filter(verb => text.includes(verb));
    const hasAndOr = /\band\b|\bor\b|,/.test(text);
    
    return actionVerbs.length > 1 || (actionVerbs.length >= 1 && hasAndOr);
  }

  private static findMissingDetails(text: string, card: TrelloCard): string[] {
    const missing: string[] = [];
    
    // Check for missing acceptance criteria
    if (!text.includes('should') && !text.includes('must') && !text.includes('will')) {
      missing.push('acceptance criteria');
    }
    
    // Check for missing technical details for complex tasks
    if (this.COMPLEXITY_KEYWORDS.some(keyword => text.includes(keyword))) {
      if (!text.includes('how') && !text.includes('using') && !text.includes('with')) {
        missing.push('implementation approach');
      }
    }
    
    // Check for missing priority/timeline
    if (!card.due && !text.includes('urgent') && !text.includes('priority')) {
      missing.push('timeline or priority');
    }
    
    return missing;
  }

  private static calculateLengthScore(text: string): number {
    // Simple scoring: 0-10 scale based on word count and sentence complexity
    const wordCount = text.split(/\s+/).length;
    const sentenceCount = text.split(/[.!?]+/).length;
    
    let score = 0;
    if (wordCount > 30) score += 4;
    else if (wordCount > 15) score += 2;
    else if (wordCount > 5) score += 1;
    
    if (sentenceCount > 3) score += 2;
    else if (sentenceCount > 1) score += 1;
    
    return Math.min(score, 10);
  }

  private static suggestTaskSplits(card: TrelloCard): string[] {
    const text = `${card.name} ${card.desc}`;
    const suggestions: string[] = [];
    
    // Split by "and" conjunctions
    const andParts = text.split(/\band\b/i);
    if (andParts.length > 1) {
      andParts.forEach((part, index) => {
        if (index > 0) {
          const cleanPart = part.trim();
          if (cleanPart.length > 10) {
            suggestions.push(`${card.name} - Part ${index + 1}: ${cleanPart.substring(0, 50)}...`);
          }
        }
      });
    }
    
    // Split by comma-separated items
    const commaParts = text.split(',');
    if (commaParts.length > 2) {
      commaParts.forEach((part, index) => {
        if (index > 0) {
          const cleanPart = part.trim();
          if (cleanPart.length > 10) {
            suggestions.push(`${card.name} - ${cleanPart.substring(0, 40)}...`);
          }
        }
      });
    }
    
    // Default split for complex tasks
    if (suggestions.length === 0 && this.calculateComplexity(text.toLowerCase(), text.split(/\s+/)) === 'complex') {
      suggestions.push(
        `${card.name} - Research and Planning`,
        `${card.name} - Implementation`,
        `${card.name} - Testing and Documentation`
      );
    }
    
    return suggestions.slice(0, 5); // Limit to 5 suggestions
  }

  private static generateClarifyingQuestions(
    card: TrelloCard,
    vagueWords: string[],
    missingDetails: string[]
  ): string[] {
    const questions: string[] = [];
    
    // Questions for vague words
    if (vagueWords.includes('improve') || vagueWords.includes('optimize')) {
      questions.push('What specific metrics should be improved?');
      questions.push('What is the current baseline and target goal?');
    }
    
    if (vagueWords.includes('fix') && card.desc.includes('issue')) {
      questions.push('What is the exact error or unexpected behavior?');
      questions.push('When does this issue occur?');
      questions.push('What should the correct behavior be?');
    }
    
    if (vagueWords.includes('handle') || vagueWords.includes('deal with')) {
      questions.push('What specific actions should be taken?');
      questions.push('What are the expected outcomes?');
    }
    
    // Questions for missing details
    if (missingDetails.includes('acceptance criteria')) {
      questions.push('How will we know when this task is complete?');
      questions.push('What are the specific requirements that must be met?');
    }
    
    if (missingDetails.includes('implementation approach')) {
      questions.push('What tools, libraries, or frameworks should be used?');
      questions.push('Are there any architectural constraints to consider?');
    }
    
    if (missingDetails.includes('timeline or priority')) {
      questions.push('What is the priority level of this task?');
      questions.push('Is there a deadline or preferred completion time?');
    }
    
    // Generic questions for very vague tasks
    if (card.desc.length < 20) {
      questions.push('Can you provide more context about what needs to be done?');
      questions.push('What is the business justification for this task?');
    }
    
    return questions.slice(0, 6); // Limit to 6 questions
  }
}