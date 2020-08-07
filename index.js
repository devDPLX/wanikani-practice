const nodeFetch = require('node-fetch');
const romaji = require('romaji');
const readline = require('readline');
const { wkKey } = require('./config.json');
//
const newRL = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
//
function getAllPages(url, key, continuation = []) {
  return new Promise((resolve, reject) => {
    nodeFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`
      }
    }).then(res => res.json()).then(json => {
      let pages = json.pages;
      if (!pages) {
        resolve(json);
      }
      for (let data of json.data) {
        continuation.push(data)
      }
      let nextURL = pages.next_url;
      if (nextURL == null) {
        resolve(continuation);
        return;
      }
      getAllPages(nextURL, key, continuation).then(result => {
        resolve(result);
      })
    }).catch(error => {
      reject(error);
    }).catch(error => {
      reject(error);
    });
  });
}

function getTestableReviews(wkKey,filterString) {
  return new Promise((resolve, reject) => {
    console.log('Loading subjects...');
    getAllPages(`https://api.wanikani.com/v2/subjects${filterString}`, wkKey).then(subjectResults => {
      if (subjectResults.error) {
        reject(`Error ${subjectResults.code}: ${subjectResults.error}`);
      }
      console.log(subjectResults.length.toString(), 'subjects found.');
      console.log('Comparing with available reviews...');
      getAllPages(`https://api.wanikani.com/v2/review_statistics`, wkKey).then(reviewResults => {
        if (reviewResults.error) {
          reject(`Error ${reviewResults.code}: ${reviewResults.error}`);
        }
        console.log(reviewResults.length.toString(), 'reviews found.');
        let subjects = subjectResults.filter(sResult => {
          let validResults = reviewResults.find(rResult => {
            let isValid = rResult.data.subject_id == sResult.id && sResult.data.characters;
            return isValid;
          });
          return validResults;
        });
        console.log(subjects.length.toString(), 'testable reviews found.');
        resolve(subjects);
      }).catch(error => {
        reject(error);
      });
    }).catch(error => {
      reject(error);
    });
  });
}

function getUserInfo() {
  return new Promise((resolve,reject) => {
    nodeFetch('https://api.wanikani.com/v2/user',{
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${wkKey}`
      }
    }).then(res => res.json()).then(json => {
      if (json.error) {
        reject(`Error ${json.code}: ${json.error}`);
        return;
      }
      resolve({
        username: json.data.username,
        level: json.data.level
      });
    }).catch(error => {
      reject(error);
    }).catch(error => {
      reject(error);
    });
  });
}

function getAnswer(review) {
  return new Promise((resolve, reject) => {
    let object = review.object;
    let characters = review.data.characters;
    let meanings = review.data.meanings;
    let validMeanings = meanings.filter(meaning => meaning.accepted_answer);
    let auxMeanings = review.data.auxiliary_meanings;
    newRL.question(`What is the meaning of the ${object}: ${characters}?\n`, function(response) {
      if (response == '!stop') {
        resolve(undefined);
        return;
      }
      if (validMeanings.find(meaning => meaning.meaning.toLowerCase() == response.toLowerCase()) ||
            auxMeanings.find(meaning => meaning.meaning.toLowerCase() == response.toLowerCase())) {
        console.log('Correct!');
        if (object == 'radical') {
          resolve(true);
          return;
        }
        let readings = review.data.readings;
        let validReadings = readings.filter(reading => reading.accepted_answer);
        newRL.question(`What is the reading of the ${object}: ${characters}?\n`, function(secondResponse) {
          if (secondResponse == '!stop') {
            resolve(undefined);
            return;
          }
          if (validReadings.find(reading => romaji.fromKana(reading.reading) == secondResponse)) {
            console.log('Correct!');
            resolve(true);
          } else {
            console.log('Incorrect.');
            let readingsArray = validReadings.map(reading => reading.reading);
            for (let reading in readingsArray) {
              readingsArray[reading] += ` (${romaji.fromKana(readingsArray[reading])})`;
            }
            let answersString = readingsArray.join(', ');
            let isMultiple = readingsArray.length > 1;
            console.log(`The correct reading${isMultiple ? 's': ''} for ${characters} ${isMultiple ? 'are' : 'is'}: ${answersString}.`);
            resolve(false);
          }
        });
      } else {
        console.log('Incorrect.');
        let meaningsArray = validMeanings.map(meaning => meaning.meaning);
        let auxArray = auxMeanings.map(meaning => meaning.meaning);
        let combinedArray = meaningsArray.concat(auxArray);
        let answersString = combinedArray.join(', ');
        let isMultiple = combinedArray.length > 1;
        console.log(`The correct meaning${isMultiple ? 's': ''} for ${characters} ${isMultiple ? 'are' : 'is'}: ${answersString}.`);
        resolve(false);
      }
    });
  });
}

async function testReviews(reviews) {
  let review = reviews[Math.floor(Math.random() * reviews.length)];
  let response = await getAnswer(review);
  if (response !== undefined) {
    console.log('\n');
    testReviews(reviews);
  } else {
    newRL.close();
  }
}

function getLevel(maxLevel) {
  return new Promise((resolve,reject) => {
    newRL.question('What level would you like to test? You can say \'all\' or just leave it blank for all levels.\n', function(levelResponse) {
      if (levelResponse == 'all' || levelResponse == '') {
        resolve('all');
        return;
      }
      let level = parseInt(levelResponse);
      if (!level) {
        console.log('You didn\'t enter a number.');
        return resolve(getLevel(maxLevel));
      }
      if (level > maxLevel) {
        console.log('You haven\'t reached that level yet!');
        return resolve(getLevel(maxLevel));
      }
      resolve(level);
    });
  })
}

function getCategoryString() {
  return new Promise((resolve,reject) => {
    newRL.question('What category would you like to test? Valid options are: radical, kanji, vocabulary, all, or just leaving it blank.\n', function(response) {
      let categories = []
      for (let category of response.split(' ')) {
        switch (category) {
          case 'radical': case 'r': categories.push('radical'); break;
          case 'kanji': case 'k': categories.push('kanji'); break;
          case 'vocabulary': case 'v': categories.push('vocabulary'); break;
          case 'all': 
            categories.push('radical','kanji','vocabulary');
            break;
          case '': 
            categories.push('radical','kanji','vocabulary'); 
            break;
          default:
            console.log('One of your options wasn\'t a valid entry.');
            return resolve(getCategoryString());
        }
      }
      resolve(categories.join(','));
    });
  });
}

async function start() {
  let userInfo = await getUserInfo();
  console.log(`Hello, ${userInfo.username}!`);
  let maxLevel = userInfo.level;
  let maxLevelRange = [];
  for (let i = 1; i <= maxLevel; i++) {
    maxLevelRange.push(i);
  }
  maxLevelRange = maxLevelRange.join(',');
  let level = await getLevel(maxLevel);
  let categoryString = await getCategoryString();
  let filterString = `?levels=${level === 'all' ? maxLevelRange : level}&types=${categoryString}`;
  getTestableReviews(wkKey,filterString).then(result => {
    testReviews(result);
  }).catch(error => {
    console.log(error);
    newRL.close();
  });
  //
}

//console.log('The color \x1b[36mblue\x1b[0m is blue.');
start();