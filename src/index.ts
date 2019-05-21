import { ApolloServer, makeExecutableSchema, addMockFunctionsToSchema } from 'apollo-server-koa';
import * as Koa from 'koa';
import * as KoaRouter from 'koa-router';
import { koa as voyagerMiddleware } from 'graphql-voyager/middleware';
import * as bodyParser from 'koa-bodyparser';
import * as serve from 'koa-static';
import * as SpotifyWebApi from 'spotify-web-api-node';
import * as bent from 'bent';

const { clientId, clientSecret } = process.env;
const redirectUri = 'http://localhost:5000/auth-code-login';
const spotifyApi = new SpotifyWebApi({
  clientId,
  clientSecret,
  redirectUri
});
const PORT = process.env.SERVER_PORT || 5000;
const VOYAGER_PATH = '/voyager'


const typeDefs = `
  type User {
    name: String
    person: Person
  }

  type Person {
    name: String
  }

  type Song {
    name: String
    thumbnailImage: String
    uri: String
  }

  type FavouriteSongPart {
    songUri: String!
    startPosition: Int!
    endPosition: Int!
    song: Song
  }

  type Query {
    users: [User]
    songs(searchText: String): [Song]
    favouriteSongsParts: [FavouriteSongPart]
  }

  type Mutation {
    play(trackId: String! playerId: String! position: Int! = 0): Boolean
    addFavouriteSongPart(songUri: String! startPosition: Int! endPosition: Int!): Boolean
  }
`;

const favouriteSongsParts = [];

const resolvers = {
  Query: {
    users: () => {
      return [];
    },
    favouriteSongsParts: () => {
      return favouriteSongsParts;
    },
    songs: async (parent, args, ctx) => {
      spotifyApi.setAccessToken(ctx.authToken);
      const trackData = await spotifyApi.searchTracks(args.searchText);

      return trackData.body.tracks.items.map(track => ({name: track.name, thumbnailImage: track.album.images[0].url, uri: track.uri}));
    }
  },
  Mutation: {
    addFavouriteSongPart: (parent, args) => {
      const { songUri, startPosition, endPosition } = args;

      favouriteSongsParts.push({
        songUri,
        startPosition,
        endPosition
      })

      return true;
    },
    play: async (parent, args, ctx) => {
      const data = {
        uris: [args.trackId],
        position_ms: args.position || 0
      };

      const headers = {
        Authorization: `Bearer ${ctx.authToken}`
      };
      const playSongRequest = bent('https://api.spotify.com/v1/me/player/', 'PUT', 204, headers);

      await playSongRequest(`play?device_id=${args.playerId}`, data);

      return true;
    }
  },
  FavouriteSongPart: {
    song: async (parent, args, ctx) => {
      spotifyApi.setAccessToken(ctx.authToken);
      const songData = await(spotifyApi.getTrack(parent.songUri.split('track:')[1]));

      return {
        name: songData.body.name,
        thumbnailImage: songData.body.album.images[0].url,
        uri: songData.body.uri
      };
    }
  }
};

const schema = makeExecutableSchema({
  typeDefs,
  resolvers,
  resolverValidationOptions: {
    requireResolversForResolveType: false,
    requireResolversForAllFields: false,
    allowResolversNotInSchema: true
  }
});

addMockFunctionsToSchema({ schema, preserveResolvers: true });
const server = new ApolloServer({
  schema,
  context: (fullContext) => {
    return {
      authToken: fullContext.ctx.headers.authorization ? fullContext.ctx.headers.authorization.replace('Bearer ', '') : ''
    };
  }
});
const app = new Koa();
app.use(serve('public'));


app.use(bodyParser({enableTypes: ['text', 'json', 'form']}));
server.applyMiddleware({ app });

// Configure Graph Visualization Routes.
const router = new KoaRouter();

router.get('/login', (ctx) => {
  const scope = 'user-read-email user-modify-playback-state streaming';
  ctx.redirect(`https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&scope=${scope}&redirect_uri=${redirectUri}`);
});

router.get('/auth-code-login', async (ctx) => {
  const authToken = await spotifyApi.authorizationCodeGrant(ctx.query.code);

  ctx.cookies.set('authToken', authToken.body.access_token, { httpOnly: false });
  ctx.cookies.set('stuff', authToken.body.access_token, { httpOnly: false });
  ctx.redirect('/');
});

router.all(VOYAGER_PATH, voyagerMiddleware({
  endpointUrl: '/graphql'
}));
app.use(router.routes());
app.use(router.allowedMethods());


// Start Koa Server with Apollo GraphQL middleware.
app.listen({ port: PORT }, () =>
  {
    console.log(`🚀 Server ready at http://localhost:${PORT}${server.graphqlPath}`);
    console.log(`GraphQL Schema Explorer ready at http://localhost:${PORT}${VOYAGER_PATH}`);
  }
);