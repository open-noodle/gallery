//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class GamesApi {
  GamesApi([ApiClient? apiClient]) : apiClient = apiClient ?? defaultApiClient;

  final ApiClient apiClient;

  /// Create a photo guessing challenge
  ///
  /// Generate and freeze a new challenge from a shared space's own photos.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  ///
  /// * [GameCreateDto] gameCreateDto (required):
  Future<Response> createChallengeWithHttpInfo(String spaceId, GameCreateDto gameCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{spaceId}/games'
      .replaceAll('{spaceId}', spaceId);

    // ignore: prefer_final_locals
    Object? postBody = gameCreateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Create a photo guessing challenge
  ///
  /// Generate and freeze a new challenge from a shared space's own photos.
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  ///
  /// * [GameCreateDto] gameCreateDto (required):
  Future<GameChallengeResponseDto?> createChallenge(String spaceId, GameCreateDto gameCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await createChallengeWithHttpInfo(spaceId, gameCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameChallengeResponseDto',) as GameChallengeResponseDto;
    
    }
    return null;
  }

  /// Start a solo photo guessing challenge
  ///
  /// Generate and freeze a new challenge from the caller's own photos, plus whichever of partner and shared-space photos they have asked for.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [GameSoloCreateDto] gameSoloCreateDto (required):
  Future<Response> createSoloChallengeWithHttpInfo(GameSoloCreateDto gameSoloCreateDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/solo';

    // ignore: prefer_final_locals
    Object? postBody = gameSoloCreateDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Start a solo photo guessing challenge
  ///
  /// Generate and freeze a new challenge from the caller's own photos, plus whichever of partner and shared-space photos they have asked for.
  ///
  /// Parameters:
  ///
  /// * [GameSoloCreateDto] gameSoloCreateDto (required):
  Future<GameChallengeResponseDto?> createSoloChallenge(GameSoloCreateDto gameSoloCreateDto, { Future<void>? abortTrigger, }) async {
    final response = await createSoloChallengeWithHttpInfo(gameSoloCreateDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameChallengeResponseDto',) as GameChallengeResponseDto;
    
    }
    return null;
  }

  /// Delete a photo guessing challenge
  ///
  /// Permanently delete a challenge, cascading its rounds and guesses.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> deleteChallengeWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'DELETE',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Delete a photo guessing challenge
  ///
  /// Permanently delete a challenge, cascading its rounds and guesses.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<void> deleteChallenge(String id, { Future<void>? abortTrigger, }) async {
    final response = await deleteChallengeWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
  }

  /// Get a photo guessing challenge
  ///
  /// Get challenge detail. Round answers are withheld until the caller has guessed that round.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getChallengeWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/{id}'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get a photo guessing challenge
  ///
  /// Get challenge detail. Round answers are withheld until the caller has guessed that round.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<GameChallengeDetailResponseDto?> getChallenge(String id, { Future<void>? abortTrigger, }) async {
    final response = await getChallengeWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameChallengeDetailResponseDto',) as GameChallengeDetailResponseDto;
    
    }
    return null;
  }

  /// List photo guessing challenges
  ///
  /// List a shared space's challenges along with the caller's progress on each.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  Future<Response> getChallengesWithHttpInfo(String spaceId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{spaceId}/games'
      .replaceAll('{spaceId}', spaceId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// List photo guessing challenges
  ///
  /// List a shared space's challenges along with the caller's progress on each.
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  Future<List<GameChallengeListItemResponseDto>?> getChallenges(String spaceId, { Future<void>? abortTrigger, }) async {
    final response = await getChallengesWithHttpInfo(spaceId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      final responseBody = await _decodeBodyBytes(response);
      return (await apiClient.deserializeAsync(responseBody, 'List<GameChallengeListItemResponseDto>') as List)
        .cast<GameChallengeListItemResponseDto>()
        .toList(growable: false);

    }
    return null;
  }

  /// Get the space's daily challenge
  ///
  /// Get today's daily challenge for a shared space, generating it on first read. Returns a null challenge when the space has no photos usable for one.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  Future<Response> getDailyChallengeWithHttpInfo(String spaceId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{spaceId}/games/daily'
      .replaceAll('{spaceId}', spaceId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get the space's daily challenge
  ///
  /// Get today's daily challenge for a shared space, generating it on first read. Returns a null challenge when the space has no photos usable for one.
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  Future<GameDailyResponseDto?> getDailyChallenge(String spaceId, { Future<void>? abortTrigger, }) async {
    final response = await getDailyChallengeWithHttpInfo(spaceId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameDailyResponseDto',) as GameDailyResponseDto;
    
    }
    return null;
  }

  /// Get a challenge leaderboard
  ///
  /// Get per-player totals for a challenge.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<Response> getLeaderboardWithHttpInfo(String id, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/{id}/leaderboard'
      .replaceAll('{id}', id);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get a challenge leaderboard
  ///
  /// Get per-player totals for a challenge.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  Future<GameLeaderboardResponseDto?> getLeaderboard(String id, { Future<void>? abortTrigger, }) async {
    final response = await getLeaderboardWithHttpInfo(id, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameLeaderboardResponseDto',) as GameLeaderboardResponseDto;
    
    }
    return null;
  }

  /// Get a round image
  ///
  /// Serve a round's photo as a generic, EXIF-free preview keyed by (challenge, round index). Never discloses the underlying asset id or original filename.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] index (required):
  Future<Response> getRoundImageWithHttpInfo(String id, int index, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/{id}/rounds/{index}/image'
      .replaceAll('{id}', id)
      .replaceAll('{index}', index.toString());

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get a round image
  ///
  /// Serve a round's photo as a generic, EXIF-free preview keyed by (challenge, round index). Never discloses the underlying asset id or original filename.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] index (required):
  Future<MultipartFile?> getRoundImage(String id, int index, { Future<void>? abortTrigger, }) async {
    final response = await getRoundImageWithHttpInfo(id, index, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'MultipartFile',) as MultipartFile;
    
    }
    return null;
  }

  /// Get the caller's daily challenge
  ///
  /// Get today's personal daily challenge, generating it on first read. Returns a null challenge when the caller has no photos usable for one.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getSoloDailyChallengeWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/solo/daily';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get the caller's daily challenge
  ///
  /// Get today's personal daily challenge, generating it on first read. Returns a null challenge when the caller has no photos usable for one.
  Future<GameDailyResponseDto?> getSoloDailyChallenge({ Future<void>? abortTrigger, }) async {
    final response = await getSoloDailyChallengeWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameDailyResponseDto',) as GameDailyResponseDto;
    
    }
    return null;
  }

  /// Get the caller's solo game history
  ///
  /// One page of the games the caller has played, newest first. Paging past the last page returns an empty page rather than an error.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of games per page
  Future<Response> getSoloHistoryWithHttpInfo({ int? page, int? size, Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/solo/history';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    if (page != null) {
      queryParams.addAll(_queryParams('', 'page', page));
    }
    if (size != null) {
      queryParams.addAll(_queryParams('', 'size', size));
    }

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get the caller's solo game history
  ///
  /// One page of the games the caller has played, newest first. Paging past the last page returns an empty page rather than an error.
  ///
  /// Parameters:
  ///
  /// * [int] page:
  ///   Page number
  ///
  /// * [int] size:
  ///   Number of games per page
  Future<GameSoloHistoryResponseDto?> getSoloHistory({ int? page, int? size, Future<void>? abortTrigger, }) async {
    final response = await getSoloHistoryWithHttpInfo(page: page, size: size, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameSoloHistoryResponseDto',) as GameSoloHistoryResponseDto;
    
    }
    return null;
  }

  /// Get the caller's solo statistics
  ///
  /// Streak, best score, average and games played, computed from the games themselves on every read. A player who has never played gets zeroes, never nulls.
  ///
  /// Note: This method returns the HTTP [Response].
  Future<Response> getSoloStatsWithHttpInfo({ Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/solo/stats';

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get the caller's solo statistics
  ///
  /// Streak, best score, average and games played, computed from the games themselves on every read. A player who has never played gets zeroes, never nulls.
  Future<GameSoloStatsResponseDto?> getSoloStats({ Future<void>? abortTrigger, }) async {
    final response = await getSoloStatsWithHttpInfo(abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameSoloStatsResponseDto',) as GameSoloStatsResponseDto;
    
    }
    return null;
  }

  /// Get the space's monthly standings
  ///
  /// Per-player totals across this UTC calendar month's daily challenges. Custom challenges never contribute. Membership-gated, like the daily.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  Future<Response> getStandingsWithHttpInfo(String spaceId, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/shared-spaces/{spaceId}/games/standings'
      .replaceAll('{spaceId}', spaceId);

    // ignore: prefer_final_locals
    Object? postBody;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>[];


    return apiClient.invokeAPI(
      apiPath,
      'GET',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Get the space's monthly standings
  ///
  /// Per-player totals across this UTC calendar month's daily challenges. Custom challenges never contribute. Membership-gated, like the daily.
  ///
  /// Parameters:
  ///
  /// * [String] spaceId (required):
  Future<GameStandingsResponseDto?> getStandings(String spaceId, { Future<void>? abortTrigger, }) async {
    final response = await getStandingsWithHttpInfo(spaceId, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameStandingsResponseDto',) as GameStandingsResponseDto;
    
    }
    return null;
  }

  /// Submit a round guess
  ///
  /// Submit a guess for one round of a challenge and receive the score and the answer.
  ///
  /// Note: This method returns the HTTP [Response].
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] index (required):
  ///
  /// * [GameGuessDto] gameGuessDto (required):
  Future<Response> guessRoundWithHttpInfo(String id, int index, GameGuessDto gameGuessDto, { Future<void>? abortTrigger, }) async {
    // ignore: prefer_const_declarations
    final apiPath = r'/games/{id}/rounds/{index}/guess'
      .replaceAll('{id}', id)
      .replaceAll('{index}', index.toString());

    // ignore: prefer_final_locals
    Object? postBody = gameGuessDto;

    final queryParams = <QueryParam>[];
    final headerParams = <String, String>{};
    final formParams = <String, String>{};

    const contentTypes = <String>['application/json'];


    return apiClient.invokeAPI(
      apiPath,
      'POST',
      queryParams,
      postBody,
      headerParams,
      formParams,
      contentTypes.isEmpty ? null : contentTypes.first,
      abortTrigger: abortTrigger,
    );
  }

  /// Submit a round guess
  ///
  /// Submit a guess for one round of a challenge and receive the score and the answer.
  ///
  /// Parameters:
  ///
  /// * [String] id (required):
  ///
  /// * [int] index (required):
  ///
  /// * [GameGuessDto] gameGuessDto (required):
  Future<GameGuessResponseDto?> guessRound(String id, int index, GameGuessDto gameGuessDto, { Future<void>? abortTrigger, }) async {
    final response = await guessRoundWithHttpInfo(id, index, gameGuessDto, abortTrigger: abortTrigger,);
    if (response.statusCode >= HttpStatus.badRequest) {
      throw ApiException(response.statusCode, await _decodeBodyBytes(response));
    }
    // When a remote server returns no body with a status of 204, we shall not decode it.
    // At the time of writing this, `dart:convert` will throw an "Unexpected end of input"
    // FormatException when trying to decode an empty string.
    if (response.body.isNotEmpty && response.statusCode != HttpStatus.noContent) {
      return await apiClient.deserializeAsync(await _decodeBodyBytes(response), 'GameGuessResponseDto',) as GameGuessResponseDto;
    
    }
    return null;
  }
}
